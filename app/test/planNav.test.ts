import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OTHER_PAGES, PLAN_VIEWS, viewName } from "../src/pages/plan/planNav";

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const line = app.split("\n").find((l) => l.includes("if (p && [")) ?? "";
const routes = [...(line.match(/\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]*)"/g)].map((m) => m[1]);

describe("planNav", () => {
  it("lists views in order", () => {
    expect(PLAN_VIEWS.map((v) => v.view)).toEqual(["", "checklist", "board", "timeline", "grid", "team", "risks", "activity"]);
  });
  it("every view and page is a plan route", () => {
    for (const v of PLAN_VIEWS) expect(routes).toContain(v.view);
    for (const k of Object.keys(OTHER_PAGES)) expect(routes).toContain(k);
  });
  it("names views", () => {
    expect(viewName("")).toBe("Overview");
    expect(viewName("report")).toBe("Status report");
  });
  it("has no em dashes", () => {
    for (const v of PLAN_VIEWS) expect(v.label + v.hint).not.toContain("—");
    for (const l of Object.values(OTHER_PAGES)) expect(l).not.toContain("—");
  });
});
