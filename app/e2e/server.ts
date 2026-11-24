/**
 * Browser-test server: the real self-hosted build (API + website) with a stand-in sign-in service.
 * The sign-in service runs on its own port with a small "choose who you are" page, so tests go
 * through the real sign-in flow (redirects, PKCE, ID token checks, session cookie).
 *   E2E_PORT (default 5180): the site.  E2E_ID_PORT (default 5181): the sign-in service.
 */
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_WORK_WEEK } from "@ezplan/shared";
import { createSelfHost } from "../../selfhost/src/host";
import { startServer } from "../../selfhost/src/server";
import { FakeOidc } from "../../server/test/fakeOidc";

const port = Number(process.env.E2E_PORT ?? 5180);
const idPort = Number(process.env.E2E_ID_PORT ?? 5181);
const publicUrl = `http://localhost:${port}`;
const today = process.env.E2E_TODAY ?? "2027-01-04";

export const PEOPLE: Record<string, { sub: string; name: string; email: string }> = {
  alex: { sub: "alex", name: "Alex Rivera", email: "alex@example.com" },
  sam: { sub: "sam", name: "Sam Okoye", email: "sam@example.com" },
  kim: { sub: "kim", name: "Kim Park", email: "kim@example.com" },
  pat: { sub: "pat", name: "Pat Lee", email: "pat@example.com" }, // on the safety review team
};

const fake = await FakeOidc.create(() => Date.now(), `http://127.0.0.1:${idPort}`);
const { app: site, rooms, db } = createSelfHost({
  dataDir: mkdtempSync(join(tmpdir(), "e2e-")),
  config: { defaultWorkWeek: DEFAULT_WORK_WEEK, publicUrl, providers: [fake.provider({ label: "Test ID" })], secureCookies: false, platformAdmins: ["pat@example.com"] },
  // A fixed "today" keeps dates in screenshots and assertions stable; real time for sign-in tokens.
  clock: { today: () => today, now: () => Date.now() },
  http: async (req) => (new URL(req.url).origin === fake.issuer ? fake.handle(req) : new Response("Tests don't reach the internet.", { status: 599 })),
  staticDir: join(import.meta.dirname, "..", "dist"),
  // A scripted AI engine (no network); real AI needs ANTHROPIC_API_KEY on a real server.
  testAi: true,
});
/**
 * Test-only: puts someone into another person's workspace as an editor, the way a company admin
 * will once the admin console exists (POST /e2e/join { person, intoWorkspaceOf }; ?leave=1 undoes it, so other tests aren't affected). Browser tests only.
 */
const app = {
  fetch: async (req: Request) => {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/e2e/join") {
      const b = (await req.json()) as { person: string; intoWorkspaceOf: string };
      const ws = await db.first<{ workspace_id: string }>(`SELECT m.workspace_id FROM members m JOIN users u ON u.id = m.user_id WHERE u.email = ? AND m.role = 'manager'`, [b.intoWorkspaceOf]);
      const who = await db.first<{ id: string }>(`SELECT id FROM users WHERE email = ?`, [b.person]);
      if (!ws || !who) return new Response("unknown person", { status: 404 });
      if (url.searchParams.get("leave")) await db.run(`DELETE FROM members WHERE workspace_id = ? AND user_id = ? AND role = 'editor'`, [ws.workspace_id, who.id]);
      else await db.run(`INSERT OR IGNORE INTO members (workspace_id, user_id, role) VALUES (?, ?, 'editor')`, [ws.workspace_id, who.id]);
      return Response.json({ ok: true });
    }
    return site.fetch(req);
  },
} as unknown as typeof site;
startServer({ app, rooms, port, onListen: (p) => console.log(`site on ${p}`) });

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", fake.issuer);
  if (url.pathname === "/authorize") {
    const links = Object.entries(PEOPLE).map(([k, p]) => `<a href="/approve?as=${k}&${url.searchParams}">Continue as ${p.name}</a>`).join("<br>");
    res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>Test ID</title><h1>Test ID</h1>${links}`);
    return;
  }
  if (url.pathname === "/approve") {
    const who = PEOPLE[url.searchParams.get("as") ?? ""];
    url.searchParams.delete("as");
    if (!who) return void res.writeHead(400).end("unknown person");
    const back = fake.authorize(`${fake.issuer}/authorize?${url.searchParams}`, { sub: who.sub, name: who.name, email: who.email, email_verified: true });
    res.writeHead(302, { location: publicUrl + back }).end();
    return;
  }
  const r = await fake.handle(new Request(url, { method: req.method ?? "GET" }));
  res.writeHead(r.status, Object.fromEntries(r.headers)).end(await r.text());
}).listen(idPort, () => console.log(`sign-in service on ${idPort}`));
