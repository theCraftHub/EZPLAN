/** The dashboard's packing: fills the lowest gap first with the first widget in order that fits; no overlaps. */
import { describe, expect, it } from "vitest";
import { pack, type PackItem } from "../src/pages/plan/pack";

const G = 16;
const at = (r: ReturnType<typeof pack>, id: string) => r.boxes.find((b) => b.id === id)!;

describe("dashboard packing", () => {
  it("a full-width widget waits; a half-width one fills the space beside a tall half", () => {
    const r = pack([{ id: "critical", w: 6, h: 300 }, { id: "kpis", w: 12, h: 100 }, { id: "update", w: 6, h: 200 }], 12, G);
    expect(at(r, "critical")).toMatchObject({ x: 0, y: 0 });
    expect(at(r, "update")).toMatchObject({ x: 6, y: 0 });
    expect(at(r, "kpis")).toMatchObject({ x: 0, y: 300 + G });
    expect(r.height).toBe(300 + G + 100);
  });

  it("keeps the order when everything fits row by row", () => {
    const r = pack(["a", "b", "c", "d"].map((id) => ({ id, w: 6, h: 100 })), 12, G);
    expect(r.boxes.map((b) => [b.id, b.x, b.y])).toEqual([["a", 0, 0], ["b", 6, 0], ["c", 0, 100 + G], ["d", 6, 100 + G]]);
  });

  it("fills the lower column first, so short widgets tuck under short ones", () => {
    const r = pack([{ id: "tall", w: 6, h: 400 }, { id: "short", w: 6, h: 100 }, { id: "next", w: 6, h: 100 }], 12, G);
    expect(at(r, "next")).toMatchObject({ x: 6, y: 100 + G });
  });

  it("three thirds share a row", () => {
    const r = pack(["a", "b", "c"].map((id) => ({ id, w: 4, h: 50 })), 12, G);
    expect(r.boxes.map((b) => b.x)).toEqual([0, 4, 8]);
    expect(new Set(r.boxes.map((b) => b.y))).toEqual(new Set([0]));
  });

  it("never overlaps and stays inside the grid (random layouts)", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < 200; n++) {
      const items: PackItem[] = Array.from({ length: 2 + Math.floor(rnd() * 10) }, (_, i) => ({ id: `w${i}`, w: [4, 6, 8, 12][Math.floor(rnd() * 4)]!, h: 40 + Math.floor(rnd() * 400) }));
      const r = pack(items, 12, G);
      expect(r.boxes).toHaveLength(items.length);
      for (const a of r.boxes) {
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.x + a.w).toBeLessThanOrEqual(12);
        for (const b of r.boxes) {
          if (a === b) continue;
          const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h + G <= b.y || b.y + b.h + G <= a.y;
          expect(apart, `${a.id} and ${b.id} overlap`).toBe(true);
        }
      }
    }
  });
});
