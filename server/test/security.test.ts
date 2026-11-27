import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { constantTimeEqual, createApp, headerSafe, isTestAddress, ruleFor } from "../src/index";

describe("security helpers", () => {
  it("test sign-in only on local or reserved test addresses", () => {
    for (const u of ["http://localhost:5180", "http://127.0.0.1:8080", "https://plans.test", "https://app.example"]) expect(isTestAddress(u)).toBe(true);
    for (const u of ["https://rakuplan.com", "https://app.rakuplan.app", "https://test.com", "https://localhost.evil.com"]) expect(isTestAddress(u)).toBe(false);
    const ports = { db: {}, blobs: {}, rooms: {}, clock: { now: () => 0, today: () => "2027-01-01" }, http: fetch, testAuth: true, config: { publicUrl: "https://rakuplan.com", providers: [], defaultWorkWeek: { hoursPerWeek: 40, workdays: [1, 2, 3, 4, 5] }, secureCookies: true } };
    expect(() => createApp(ports as never)).toThrow(/TEST_AUTH is on/);
  });
  it("email header text has no line breaks", () => {
    expect(headerSafe("Hi\r\nBcc: a@b.c x")).toBe("Hi Bcc: a@b.c x");
  });
  it("constant-time comparison", () => {
    expect(constantTimeEqual("Bearer abc", "Bearer abc")).toBe(true);
    expect(constantTimeEqual("Bearer abd", "Bearer abc")).toBe(false);
    expect(constantTimeEqual("Bearer ab", "Bearer abc")).toBe(false);
  });
  it("sends invite, company, domain and help-request routes to their own limits", () => {
    expect(ruleFor("POST", "/api/orgs")).toBe("orgCreate");
    expect(ruleFor("POST", "/api/orgs/x/invites")).toBe("invites");
    expect(ruleFor("POST", "/api/plans/x/invites")).toBe("invites");
    expect(ruleFor("POST", "/api/orgs/x/domains/a.com/check")).toBe("domains");
    expect(ruleFor("POST", "/api/support/tickets")).toBe("support");
    expect(ruleFor("GET", "/api/orgs")).toBeNull();
  });
});

/** The code itself: nothing that turns text into HTML or code. A failing line here needs a security review. */
describe("code scan", () => {
  const root = join(import.meta.dirname, "..", "..");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === "node_modules" || f === "dist" ? [] : files(p)) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
  const sources = ["app/src", "server/src", "shared/src", "worker/src", "selfhost/src"].flatMap((d) => files(join(root, d)));
  it.each([
    ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
    ["innerHTML / outerHTML", /\.(inner|outer)HTML\s*=/],
    ["insertAdjacentHTML", /insertAdjacentHTML/],
    ["document.write", /document\.write/],
    ["eval", /(^|[^.\w])eval\s*\(/],
    ["new Function", /new Function\s*\(/],
    ["string timers", /set(Timeout|Interval)\(\s*["'`]/],
  ])("no %s", (_name, re) => {
    const hits = sources.filter((f) => re.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
