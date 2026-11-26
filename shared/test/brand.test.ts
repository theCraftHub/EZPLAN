import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND, exportPlan, FORMAT_KEYS, parsePlan } from "../src";

const root = join(import.meta.dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name.startsWith("dist") ? [] : sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe("brand isolation (renaming = editing brand.ts)", () => {
  it("no source file outside brand.ts contains the brand name", () => {
    const files = ["shared/src", "server/src", "selfhost/src", "app/src", "app/spikes", "worker/src"].flatMap((d) => sourceFiles(join(root, d)));
    expect(files.length).toBeGreaterThan(3);
    const offenders = files
      .filter((f) => !f.endsWith("brand.ts"))
      .filter((f) => /ezplan|rakuplan/i.test(readFileSync(f, "utf8").replace(/@rakuplan\//g, "")));
    expect(offenders).toEqual([]);
  });

  it("exports use the current brand's header key", () => {
    const { plan } = parsePlan(`---\n${BRAND.formatKey}: 1\ntitle: X\n---\n## P1: A\n- [ ] T1: B`);
    expect(exportPlan(plan).split("\n")[1]).toBe(`${BRAND.formatKey}: 1`);
  });

  it("files written under the old EZPLAN codename still import", () => {
    const oldFile = `---\nezplan: 1\ntitle: Old file\n---\n## P1: A\n- [x] T1: Done thing (1d)`;
    const fromOld = parsePlan(oldFile);
    const fromNew = parsePlan(oldFile.replace("ezplan: 1", `${BRAND.formatKey}: 1`));
    expect(fromOld.mode).toBe("strict");
    expect(fromNew.plan).toEqual(fromOld.plan);
    expect(exportPlan(fromOld.plan).split("\n")[1]).toBe(`${BRAND.formatKey}: 1`);
  });

  it("after a future rename, files written under the old name still import", () => {
    const oldFile = `---\nezplan: 1\ntitle: Old file\n---\n## P1: A\n- [x] T1: Done thing (1d)`;
    const renamedKeys = [...FORMAT_KEYS, "newname"];
    const fromOld = parsePlan(oldFile, { formatKeys: renamedKeys });
    const fromNew = parsePlan(oldFile.replace("ezplan: 1", "newname: 1"), { formatKeys: renamedKeys });
    expect(fromOld.mode).toBe("strict");
    expect(fromNew.mode).toBe("strict");
    expect(fromNew.plan).toEqual(fromOld.plan);
    expect(fromOld.plan.phases[0]!.tasks[0]!.status).toBe("done");
  });
});
