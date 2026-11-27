/**
 * Calendar files (step N3, RFC 5545). Writing: a plan's tasks and milestones as all-day events with
 * stable IDs, so a subscribed calendar updates them instead of adding copies. Reading: only how many
 * hours someone is busy on each day, from their own calendar's private address; event titles and
 * details are never kept.
 */
export interface IcsEvent { uid: string; title: string; start: string; end: string; description?: string; done?: boolean }

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const day = (isoDate: string) => isoDate.replace(/-/g, "");
const nextDay = (isoDate: string) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Lines longer than 75 bytes continue on the next line, starting with a space. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (parts.length ? 74 : 75)) { parts.push(cur); cur = ""; len = 0; }
    cur += ch;
    len += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

export function writeIcs(name: string, events: IcsEvent[], stamp: Date, product: string): string {
  const ts = stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${product}//EN`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(name)}`];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}`,
      `DTSTAMP:${ts}`,
      `DTSTART;VALUE=DATE:${day(e.start)}`,
      `DTEND;VALUE=DATE:${day(nextDay(e.end))}`,
      `SUMMARY:${esc(e.done ? `✓ ${e.title}` : e.title)}`,
      ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------- reading busy time

type Props = Record<string, { params: Record<string, string>; value: string }[]>;

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function events(text: string): Props[] {
  const out: Props[] = [];
  let cur: Props | null = null;
  let depth = 0;
  for (const raw of unfold(text)) {
    const line = raw.trimEnd();
    if (line === "BEGIN:VEVENT") { cur = {}; depth = 0; continue; }
    if (!cur) continue;
    if (line.startsWith("BEGIN:")) { depth++; continue; } // VALARM etc.
    if (line.startsWith("END:") && depth > 0) { depth--; continue; }
    if (line === "END:VEVENT") { out.push(cur); cur = null; continue; }
    if (depth > 0) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const [name, ...params] = line.slice(0, colon).split(";");
    const p: Record<string, string> = {};
    for (const kv of params) { const i = kv.indexOf("="); if (i > 0) p[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1); }
    (cur[name!.toUpperCase()] ??= []).push({ params: p, value: line.slice(colon + 1) });
  }
  return out;
}

/** A date or date-time value as [date, minutes into the day, all-day?]. Times are read as written (the person's own zone). */
function when(v: { params: Record<string, string>; value: string }): { date: string; min: number; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?$/.exec(v.value.trim());
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4] || v.params.VALUE === "DATE") return { date, min: 0, allDay: true };
  return { date, min: Number(m[4]) * 60 + Number(m[5]), allDay: false };
}

const WD = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Start dates of a recurring event within [from, to] (daily, weekly with days, monthly by date; COUNT, UNTIL, INTERVAL). */
function occurrences(start: string, rrule: string | undefined, from: string, to: string, exdates: Set<string>): string[] {
  if (!rrule) return start >= addDays(from, -1) && start <= to ? [start] : [];
  const r = Object.fromEntries(rrule.split(";").map((kv) => kv.split("=") as [string, string]));
  const interval = Math.max(1, Number(r.INTERVAL) || 1);
  const until = r.UNTIL ? `${r.UNTIL.slice(0, 4)}-${r.UNTIL.slice(4, 6)}-${r.UNTIL.slice(6, 8)}` : null;
  let count = r.COUNT ? Number(r.COUNT) : Infinity;
  const out: string[] = [];
  const byday = r.BYDAY ? r.BYDAY.split(",").map((x) => WD.indexOf(x.slice(-2))).filter((x) => x >= 0) : null;
  const take = (d: string) => {
    if (count <= 0 || (until && d > until) || d > to) return false;
    count--;
    if (d >= addDays(from, -1) && !exdates.has(d)) out.push(d);
    return true;
  };
  if (r.FREQ === "DAILY") {
    for (let d = start; take(d); d = addDays(d, interval));
  } else if (r.FREQ === "WEEKLY") {
    const days = byday?.length ? byday : [new Date(`${start}T00:00:00Z`).getUTCDay()];
    const weekStart = addDays(start, -new Date(`${start}T00:00:00Z`).getUTCDay());
    outer: for (let w = weekStart; w <= to; w = addDays(w, 7 * interval)) {
      for (const wd of [...days].sort()) {
        const d = addDays(w, wd);
        if (d < start) continue;
        if (!take(d)) break outer;
      }
    }
  } else if (r.FREQ === "MONTHLY") {
    const [y, m, dd] = start.split("-").map(Number) as [number, number, number];
    for (let i = 0; ; i += interval) {
      const dt = new Date(Date.UTC(y, m - 1 + i, dd));
      if (dt.getUTCDate() !== dd) continue; // that month has no such day
      if (!take(dt.toISOString().slice(0, 10))) break;
    }
  } else if (start >= from && start <= to) out.push(start);
  return out;
}

/**
 * Hours busy per date between `from` and `to` (YYYY-MM-DD), from a calendar file. Free/transparent and
 * cancelled events are skipped; an all-day busy event counts as the whole day.
 */
export function busyFromIcs(text: string, from: string, to: string): Record<string, number> {
  const busy: Record<string, number> = {};
  for (const e of events(text)) {
    if (e.TRANSP?.[0]?.value === "TRANSPARENT" || e.STATUS?.[0]?.value === "CANCELLED") continue;
    const s = e.DTSTART?.[0] && when(e.DTSTART[0]);
    if (!s) continue;
    const endRaw = e.DTEND?.[0] && when(e.DTEND[0]);
    const durMin = s.allDay ? 24 * 60 * Math.max(1, endRaw ? Math.round((Date.parse(endRaw.date) - Date.parse(s.date)) / 86_400_000) : 1) : endRaw ? Math.max(0, (Date.parse(endRaw.date) - Date.parse(s.date)) / 60_000 + endRaw.min - s.min) : 60;
    const ex = new Set((e.EXDATE ?? []).flatMap((x) => x.value.split(",")).map((v) => when({ params: {}, value: v })?.date).filter((d): d is string => !!d));
    for (const startDate of occurrences(s.date, e.RRULE?.[0]?.value, from, to, ex)) {
      // Spread the event's minutes over the days it covers.
      let left = durMin;
      let date = startDate;
      let offset = s.min;
      while (left > 0) {
        const today = Math.min(left, 24 * 60 - offset);
        if (date >= from && date <= to) busy[date] = Math.min(24, (busy[date] ?? 0) + today / 60);
        left -= today;
        offset = 0;
        date = addDays(date, 1);
      }
    }
  }
  for (const k of Object.keys(busy)) busy[k] = Math.round(busy[k]! * 4) / 4;
  return busy;
}
