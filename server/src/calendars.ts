/**
 * Calendars (step N3, plan sections 3c and 6).
 * - Busy times in: someone pastes their own calendar's private address (Google, Outlook, Apple,
 *   Proton, Fastmail, Zoho). Only those providers are fetched (never an address on a private
 *   network), redirects are refused, and only hours busy per day are kept, never what the events
 *   are. Refreshed by the scheduled jobs every 6 hours; scheduling treats the hours as taken.
 * - Out: a private live feed per person (their tasks and milestones; Google, Outlook and Apple can
 *   subscribe), and an .ics download per plan. Events keep stable IDs so calendars update them.
 */
import type { Context, Hono } from "hono";
import { allTasks, BRAND, busyFromIcs, sameName, writeIcs, type IcsEvent, type LeveledSchedule, type Plan } from "@rakuplan/shared";
import type { Db, Clock, HttpFetch, User } from "./ports";
import { randomToken, sha256 } from "./sessions";

const DAY = 86_400_000;
export const SYNC_EVERY = 6 * 3_600_000;
const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED = [/^calendar\.google\.com$/, /^outlook\.(office365|office|live)\.com$/, /^p\d+-(caldav|calendars|calendarws)\.icloud\.com$/, /^calendar\.proton\.me$/, /^(www\.|caldav\.)?fastmail\.com$/, /^calendar\.zoho\.(com|eu)$/];
export const PROVIDERS_HINT = "Use the private calendar address from Google Calendar, Outlook, Apple iCloud, Proton, Fastmail or Zoho.";

/** A calendar address we may fetch, or a reason it can't be used. */
export function calendarUrl(raw: string): { url: string; host: string } | { error: string } {
  let u: URL;
  try { u = new URL(raw.trim().replace(/^webcals?:\/\//i, "https://")); } catch { return { error: `That isn't a web address. ${PROVIDERS_HINT}` }; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return { error: `Only https addresses can be used. ${PROVIDERS_HINT}` };
  if (!ALLOWED.some((re) => re.test(u.hostname.toLowerCase()))) return { error: `${u.hostname} isn't a calendar service we can read. ${PROVIDERS_HINT}` };
  return { url: u.toString(), host: u.hostname.toLowerCase() };
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Fetches a calendar and returns busy hours per day for the next 120 days. */
export async function fetchBusy(http: HttpFetch, url: string, today: string): Promise<{ busy: Record<string, number> } | { error: string }> {
  let res: Response;
  try {
    res = await http(new Request(url, { redirect: "manual", headers: { accept: "text/calendar" } }));
  } catch {
    return { error: "We couldn't reach that calendar just now. We'll try again." };
  }
  if (res.status >= 300 && res.status < 400) return { error: "That calendar address redirects somewhere else. Copy the private address again." };
  if (!res.ok) return { error: res.status === 404 || res.status === 403 ? "That calendar address didn't work. It may have been reset: copy it again." : "The calendar service didn't answer properly. We'll try again." };
  const text = (await res.text()).slice(0, MAX_BYTES);
  if (!text.includes("BEGIN:VCALENDAR")) return { error: "That address isn't a calendar file. Copy the private iCal (.ics) address." };
  return { busy: busyFromIcs(text, today, addDays(today, 120)) };
}

/** Busy hours from connected calendars for people in a plan, by the name the plan uses for them. */
export async function busyByName(db: Db, planId: string, names: string[]): Promise<Record<string, Record<string, number>>> {
  const people = await db.all<{ id: string; name: string; busy: string }>(
    `SELECT u.id, u.name, c.busy FROM calendar_sources c JOIN users u ON u.id = c.user_id
     WHERE c.user_id IN (SELECT m.user_id FROM members m JOIN plans p ON p.workspace_id = m.workspace_id WHERE p.id = ? UNION SELECT user_id FROM plan_members WHERE plan_id = ?)`,
    [planId, planId],
  );
  if (!people.length) return {};
  const linked = await db.all<{ name: string; user_id: string }>(`SELECT name, user_id FROM plan_people WHERE plan_id = ? AND user_id IS NOT NULL`, [planId]);
  const out: Record<string, Record<string, number>> = {};
  for (const name of names) {
    const link = linked.find((l) => l.name.toLowerCase() === name.toLowerCase());
    const who = people.find((p) => (link ? p.id === link.user_id : sameName(name, p.name)));
    if (who) out[name] = JSON.parse(who.busy) as Record<string, number>;
  }
  return out;
}

export interface CalendarDeps {
  db: Db;
  clock: Clock;
  http: HttpFetch;
  siteOrigin: string;
  notFound: { error: string };
  access: (planId: string, userId: string) => Promise<{ title: string; state: string } | null>;
  plan: (planId: string, today: string) => Promise<{ plan: Plan; schedule: LeveledSchedule } | null>;
  limited: (c: Context) => Promise<Response | null>;
}

const uid = (planId: string, taskId: string) => `${planId}-${taskId}@${BRAND.domain}`;
const ics = (text: string, file: string, download: boolean) =>
  new Response(text, { headers: { "content-type": "text/calendar; charset=utf-8", ...(download ? { "content-disposition": `attachment; filename="${file}"` } : {}), "cache-control": "no-store" } });

/** One plan as calendar events: every task (done ones ticked) and milestone, on its scheduled dates. */
function planEvents(planId: string, plan: Plan, schedule: LeveledSchedule, only?: (t: Plan["phases"][number]["tasks"][number]) => boolean): IcsEvent[] {
  return allTasks(plan).filter((t) => !only || only(t)).flatMap((t) => {
    const s = schedule.tasks.get(t.id);
    if (!s) return [];
    return [{ uid: uid(planId, t.id), title: t.milestone ? `◆ ${t.title}` : t.title, start: t.milestone ? s.end : s.start, end: s.end, done: t.status === "done", description: `${plan.title}${t.owner ? ` · ${t.owner}` : ""}` }];
  });
}

export function registerPublicCalendarRoute(app: Hono, d: CalendarDeps) {
  // A person's private live feed: no sign-in (calendar apps fetch it), the token is the key.
  app.get("/api/calendar/:file", async (c) => {
    const limited = await d.limited(c);
    if (limited) return limited;
    const token = c.req.param("file").replace(/\.ics$/, "");
    if (!token || token.length > 100) return c.json({ error: "This calendar link doesn't work." }, 404);
    const feed = await d.db.first<{ user_id: string }>(`SELECT user_id FROM calendar_feeds WHERE token_hash = ?`, [await sha256(token)]);
    const user = feed ? await d.db.first<{ id: string; name: string; suspended_at: number | null }>(`SELECT id, name, suspended_at FROM users WHERE id = ?`, [feed.user_id]) : null;
    if (!user || user.suspended_at) return c.json({ error: "This calendar link doesn't work." }, 404);
    const today = d.clock.today();
    const plans = await d.db.all<{ id: string }>(
      `SELECT p.id FROM plans p WHERE p.state = 'active' AND (p.workspace_id IN (SELECT workspace_id FROM members WHERE user_id = ?) OR p.id IN (SELECT plan_id FROM plan_members WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?))) ORDER BY p.updated_at DESC LIMIT 100`,
      [user.id, user.id, d.clock.now()],
    );
    const events: IcsEvent[] = [];
    for (const { id } of plans) {
      const got = await d.plan(id, today);
      if (!got) continue;
      const linked = new Set((await d.db.all<{ name_key: string }>(`SELECT name_key FROM plan_people WHERE plan_id = ? AND user_id = ?`, [id, user.id])).map((r) => r.name_key));
      const mine = (n?: string) => !!n && (sameName(n, user.name) || linked.has(n.trim().toLowerCase()));
      events.push(...planEvents(id, got.plan, got.schedule, (t) => t.milestone || mine(t.owner)));
    }
    return ics(writeIcs(`${BRAND.name}: ${user.name}`, events, new Date(d.clock.now()), `${BRAND.name}//Calendar`), "calendar.ics", false);
  });
}

export function registerCalendarRoutes(app: Hono<{ Variables: { user: User } }>, d: CalendarDeps) {
  const { db, clock } = d;

  app.get("/api/plans/:id/calendar.ics", async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const a = await d.access(id, user.id);
    if (!a) return c.json(d.notFound, 404);
    const got = await d.plan(id, clock.today());
    if (!got) return c.json(d.notFound, 404);
    const name = (got.plan.title.replace(/[^\w .-]+/g, "").trim() || "plan").slice(0, 80);
    return ics(writeIcs(got.plan.title, planEvents(id, got.plan, got.schedule), new Date(clock.now()), `${BRAND.name}//Calendar`), `${name}.ics`, true);
  });

  // The personal feed: shown once when made; making a new one stops the old one working.
  app.get("/api/me/calendar-feed", async (c) => {
    const row = await db.first<{ created_at: number }>(`SELECT created_at FROM calendar_feeds WHERE user_id = ?`, [c.get("user").id]);
    return c.json({ active: !!row, createdAt: row ? Number(row.created_at) : null });
  });
  app.post("/api/me/calendar-feed", async (c) => {
    const token = randomToken();
    await db.run(`INSERT INTO calendar_feeds (user_id, token_hash, created_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at`, [c.get("user").id, await sha256(token), clock.now()]);
    return c.json({ url: `${d.siteOrigin}/api/calendar/${token}.ics` }, 201);
  });
  app.delete("/api/me/calendar-feed", async (c) => {
    await db.run(`DELETE FROM calendar_feeds WHERE user_id = ?`, [c.get("user").id]);
    return c.json({ ok: true });
  });

  // Busy times from your own calendar.
  app.get("/api/me/calendar-busy", async (c) => {
    const row = await db.first<{ host: string; busy: string; synced_at: number | null; error: string | null }>(`SELECT host, busy, synced_at, error FROM calendar_sources WHERE user_id = ?`, [c.get("user").id]);
    if (!row) return c.json({ connected: false });
    const busy = JSON.parse(row.busy) as Record<string, number>;
    const today = clock.today();
    const next = Object.entries(busy).filter(([d]) => d >= today && d <= addDays(today, 13)).sort(([a], [b]) => a.localeCompare(b)).map(([date, hours]) => ({ date, hours }));
    return c.json({ connected: true, host: row.host, syncedAt: row.synced_at === null ? null : Number(row.synced_at), error: row.error, next });
  });
  app.put("/api/me/calendar-busy", async (c) => {
    const b = await c.req.json<{ url?: unknown }>().catch(() => null);
    const checked = calendarUrl(typeof b?.url === "string" ? b.url : "");
    if ("error" in checked) return c.json({ error: checked.error }, 400);
    const got = await fetchBusy(d.http, checked.url, clock.today());
    if ("error" in got) return c.json({ error: got.error }, 400);
    await db.run(`INSERT INTO calendar_sources (user_id, url, host, busy, synced_at, error) VALUES (?, ?, ?, ?, ?, NULL) ON CONFLICT (user_id) DO UPDATE SET url = excluded.url, host = excluded.host, busy = excluded.busy, synced_at = excluded.synced_at, error = NULL`, [c.get("user").id, checked.url, checked.host, JSON.stringify(got.busy), clock.now()]);
    return c.json({ connected: true, host: checked.host, days: Object.keys(got.busy).length });
  });
  app.delete("/api/me/calendar-busy", async (c) => {
    await db.run(`DELETE FROM calendar_sources WHERE user_id = ?`, [c.get("user").id]);
    return c.json({ ok: true });
  });
}

/** Scheduled job: refresh connected calendars older than 6 hours. */
export async function syncCalendars(d: { db: Db; clock: Clock; http: HttpFetch }, now: number): Promise<number> {
  const due = await d.db.all<{ user_id: string; url: string }>(`SELECT user_id, url FROM calendar_sources WHERE synced_at IS NULL OR synced_at < ? LIMIT 200`, [now - SYNC_EVERY]);
  let n = 0;
  for (const s of due) {
    const got = await fetchBusy(d.http, s.url, new Date(now).toISOString().slice(0, 10));
    if ("error" in got) await d.db.run(`UPDATE calendar_sources SET error = ?, synced_at = ? WHERE user_id = ?`, [got.error, now, s.user_id]);
    else { await d.db.run(`UPDATE calendar_sources SET busy = ?, synced_at = ?, error = NULL WHERE user_id = ?`, [JSON.stringify(got.busy), now, s.user_id]); n++; }
  }
  return n;
}
