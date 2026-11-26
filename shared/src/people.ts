/**
 * Reading a list of people pasted or uploaded by a company admin (step L2): a CSV or spreadsheet
 * export with a header row (columns matched by name), or plain lines such as
 * "Ivan Petrov <ivan@northfield.com>", "ivan@northfield.com" or "Ivan Petrov, ivan@northfield.com".
 * Nothing is checked against the company here; the server's dry run does that row by row.
 */

export interface PersonRow {
  /** 1-based line (or row) number in what was pasted, for pointing at problems. */
  line: number;
  email: string;
  name?: string;
  department?: string;
  /** An org role key when the role column was understood ("member", "admin", ...). */
  role?: string;
  /** The role as written, when it wasn't understood. */
  roleText?: string;
  /** A workspace name, matched to the company's workspaces by the caller. */
  workspace?: string;
}

export type PeopleColumn = "email" | "name" | "first" | "last" | "department" | "role" | "workspace";

export interface ParsedPeople {
  rows: PersonRow[];
  /** Header mode: which column each field came from, as written in the header. */
  columns: Partial<Record<PeopleColumn, string>> | null;
  /** Lines that had no email address in them. */
  skipped: { line: number; text: string }[];
}

const EMAIL = /[^\s<>"',;()]+@[^\s<>"',;()]+\.[a-z]{2,}/i;

const SYNONYMS: Record<PeopleColumn, string[]> = {
  email: ["email", "e-mail", "email address", "e-mail address", "work email", "mail", "emailaddress", "primary email"],
  name: ["name", "full name", "fullname", "person", "employee", "display name", "employee name"],
  first: ["first name", "firstname", "given name", "first"],
  last: ["last name", "lastname", "surname", "family name", "last"],
  department: ["department", "dept", "team", "group", "division"],
  role: ["role", "access", "permission", "permissions", "access level"],
  workspace: ["workspace", "space"],
};

const ROLE_WORDS: Record<string, string> = {
  owner: "owner",
  admin: "admin", administrator: "admin",
  "department admin": "dept_admin", "dept admin": "dept_admin", manager: "dept_admin", "team admin": "dept_admin",
  helpdesk: "helpdesk", "help desk": "helpdesk", support: "helpdesk",
  auditor: "auditor",
  member: "member", editor: "member", user: "member", employee: "member", staff: "member",
  guest: "guest", contractor: "guest", external: "guest",
};

/** An org role from what someone typed ("Admin", "Manager", "editor"), or null. */
export function roleFromText(text: string): string | null {
  return ROLE_WORDS[text.trim().toLowerCase().replace(/\s+/g, " ")] ?? null;
}

/** Splits CSV-style text into rows, honouring quotes (which may hold delimiters and line breaks). */
function splitRows(text: string, delim: string): { cells: string[]; line: number }[] {
  const out: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else { if (ch === "\n") line++; cell += ch; }
    } else if (ch === '"' && cell.trim() === "") { quoted = true; cell = ""; }
    else if (ch === delim) { cells.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cells.push(cell);
      out.push({ cells, line: rowLine });
      cells = []; cell = ""; line++; rowLine = line;
    } else cell += ch;
  }
  cells.push(cell);
  out.push({ cells, line: rowLine });
  return out.map((r) => ({ ...r, cells: r.cells.map((c) => c.trim()) })).filter((r) => r.cells.some((c) => c));
}

/** The delimiter used on the first non-empty line: tab, semicolon or comma (most frequent wins). */
function delimiterOf(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const outside = first.replace(/"[^"]*"/g, "");
  const counts = ["\t", ";", ","].map((d) => [d, outside.split(d).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ",";
}

function headerColumns(cells: string[]): Partial<Record<PeopleColumn, number>> | null {
  const found: Partial<Record<PeopleColumn, number>> = {};
  cells.forEach((c, i) => {
    const k = c.toLowerCase().replace(/[_*]+/g, " ").replace(/\s+/g, " ").trim();
    for (const [col, words] of Object.entries(SYNONYMS) as [PeopleColumn, string[]][]) {
      if (found[col] === undefined && words.includes(k)) { found[col] = i; break; }
    }
  });
  return found.email !== undefined ? found : null;
}

const tidy = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const clean = (s: string | undefined) => (s ?? "").replace(/^["'<\s]+|["'>\s]+$/g, "").replace(/\s+/g, " ").trim();

function withRole(row: PersonRow, text: string | undefined): PersonRow {
  const t = clean(text);
  if (!t) return row;
  const role = roleFromText(t);
  return role ? { ...row, role } : { ...row, roleText: t };
}

export function parsePeople(text: string): ParsedPeople {
  const src = text.replace(/^﻿/, "");
  const delim = delimiterOf(src);
  const rows = splitRows(src, delim);
  const skipped: ParsedPeople["skipped"] = [];
  const header = rows.length ? headerColumns(rows[0]!.cells) : null;

  if (header) {
    const head = rows[0]!.cells;
    const columns: ParsedPeople["columns"] = {};
    for (const [col, i] of Object.entries(header) as [PeopleColumn, number][]) columns[col] = head[i];
    const out: PersonRow[] = [];
    for (const r of rows.slice(1)) {
      const at = (col: PeopleColumn) => (header[col] === undefined ? undefined : r.cells[header[col]!]);
      const email = tidy(at("email")).toLowerCase();
      if (!email) { skipped.push({ line: r.line, text: r.cells.join(delim === "\t" ? " " : `${delim} `) }); continue; }
      const name = tidy(at("name")) || [tidy(at("first")), tidy(at("last"))].filter(Boolean).join(" ");
      let row: PersonRow = { line: r.line, email };
      if (name) row.name = name;
      if (tidy(at("department"))) row.department = tidy(at("department"));
      if (tidy(at("workspace"))) row.workspace = tidy(at("workspace"));
      row = withRole(row, at("role"));
      out.push(row);
    }
    return { rows: out, columns, skipped };
  }

  // Plain lines: find the address; the rest is the name (and, with several cells, the department).
  const out: PersonRow[] = [];
  for (const r of rows) {
    const joined = r.cells.join(" ");
    const m = EMAIL.exec(joined);
    if (!m) { skipped.push({ line: r.line, text: r.cells.join(`${delim === "\t" ? " " : delim} `) }); continue; }
    const email = m[0].toLowerCase();
    let row: PersonRow = { line: r.line, email };
    if (r.cells.length >= 2) {
      const others = r.cells.filter((c) => !c.includes(m[0]));
      const own = r.cells.find((c) => c.includes(m[0]))!;
      const beside = clean(own.replace(m[0], "").replace(/[<>]/g, ""));
      const name = beside || clean(others[0]);
      if (name) row.name = name;
      const rest = (beside ? others : others.slice(1)).map(clean).filter(Boolean);
      const role = rest.find((c) => roleFromText(c));
      const dept = rest.find((c) => c !== role);
      if (dept) row.department = dept;
      if (role) row = withRole(row, role);
    } else {
      const name = clean(joined.replace(m[0], "").replace(/[<>()]/g, ""));
      if (name) row.name = name;
    }
    out.push(row);
  }
  return { rows: out, columns: null, skipped };
}
