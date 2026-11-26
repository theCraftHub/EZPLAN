import { describe, expect, it } from "vitest";
import { parsePeople, roleFromText } from "../src/people";

describe("parsePeople", () => {
  it("reads plain lines in the common shapes and skips lines without an address", () => {
    const r = parsePeople("Ivan Petrov <ivan@northfield.com>\nmei@northfield.com\n\nOmar Haddad, OMAR@northfield.com\nnot a person\n");
    expect(r.columns).toBeNull();
    expect(r.rows).toEqual([
      { line: 1, email: "ivan@northfield.com", name: "Ivan Petrov" },
      { line: 2, email: "mei@northfield.com" },
      { line: 4, email: "omar@northfield.com", name: "Omar Haddad" },
    ]);
    expect(r.skipped).toEqual([{ line: 5, text: "not a person" }]);
  });

  it("matches CSV columns by header name, in any order, with quotes and first/last names", () => {
    const csv = 'Department,Work Email,First name,Last name,Role\r\nField Ops,ana@northfield.com,Ana,Lima,Manager\r\n"Office, North",jun@northfield.com,Jun,Watanabe,Admin\r\nIT,ravi@northfield.com,"Ravi ""R""",Shah,Wizard\r\n';
    const r = parsePeople(csv);
    expect(r.columns).toEqual({ department: "Department", email: "Work Email", first: "First name", last: "Last name", role: "Role" });
    expect(r.rows).toEqual([
      { line: 2, email: "ana@northfield.com", name: "Ana Lima", department: "Field Ops", role: "dept_admin" },
      { line: 3, email: "jun@northfield.com", name: "Jun Watanabe", department: "Office, North", role: "admin" },
      { line: 4, email: "ravi@northfield.com", name: 'Ravi "R" Shah', department: "IT", roleText: "Wizard" },
    ]);
  });

  it("handles semicolons and tabs (spreadsheet exports), a byte-order mark, and rows missing an address", () => {
    const semi = parsePeople("﻿Name;E-mail;Team\nIvan Petrov;ivan@northfield.com;IT\nNo Address;;Sales\n");
    expect(semi.rows).toEqual([{ line: 2, email: "ivan@northfield.com", name: "Ivan Petrov", department: "IT" }]);
    expect(semi.skipped).toEqual([{ line: 3, text: "No Address; ; Sales" }]);
    const tabs = parsePeople("Full name\tEmail\tWorkspace\nMei Chen\tmei@northfield.com\tEstimating\n");
    expect(tabs.rows).toEqual([{ line: 2, email: "mei@northfield.com", name: "Mei Chen", workspace: "Estimating" }]);
  });

  it("reads name, address, department and role from plain comma lines", () => {
    expect(parsePeople("Ana Lima, ana@northfield.com, Field Ops, admin").rows).toEqual([{ line: 1, email: "ana@northfield.com", name: "Ana Lima", department: "Field Ops", role: "admin" }]);
  });

  it("understands role words", () => {
    expect(roleFromText(" Department  Admin ")).toBe("dept_admin");
    expect(roleFromText("Editor")).toBe("member");
    expect(roleFromText("contractor")).toBe("guest");
    expect(roleFromText("boss")).toBeNull();
  });
});
