/**
 * Dashboard packing (owner, Nov 25: widgets should flow to fill the space). A skyline packer on a
 * column grid: it always fills the lowest open spot first (leftmost on a tie) with the first widget
 * in the person's order that fits its width there. A widget too wide for that spot waits; if
 * nothing fits, the spot is raised to its lower neighbour and joins it. So small widgets tuck into
 * gaps beside tall ones, wide ones take the next full stretch, and nothing ever overlaps.
 */
export interface PackItem { id: string; w: number; h: number }
export interface PackBox extends PackItem { x: number; y: number }

export function pack(items: PackItem[], cols: number, gap: number): { boxes: PackBox[]; height: number } {
  // The skyline: where the next widget could start, per stretch of columns.
  let sky: { x: number; w: number; y: number }[] = [{ x: 0, w: cols, y: 0 }];
  const queue = items.map((it) => ({ ...it, w: Math.max(1, Math.min(cols, it.w)) }));
  const boxes: PackBox[] = [];
  const merge = () => {
    const out: typeof sky = [];
    for (const s of sky) {
      const last = out[out.length - 1];
      if (last && last.y === s.y && last.x + last.w === s.x) last.w += s.w;
      else out.push({ ...s });
    }
    sky = out;
  };
  while (queue.length) {
    merge();
    let i = 0;
    for (let k = 1; k < sky.length; k++) if (sky[k]!.y < sky[i]!.y) i = k;
    const spot = sky[i]!;
    const pick = queue.findIndex((it) => it.w <= spot.w);
    if (pick < 0) {
      // Nothing fits here: raise it to the lower of its neighbours so it joins a wider stretch.
      const nb = [sky[i - 1]?.y, sky[i + 1]?.y].filter((v): v is number => v !== undefined);
      spot.y = Math.min(...nb);
      continue;
    }
    const it = queue.splice(pick, 1)[0]!;
    boxes.push({ ...it, x: spot.x, y: spot.y });
    const used = { x: spot.x, w: it.w, y: spot.y + it.h + gap };
    const rest = spot.w > it.w ? [{ x: spot.x + it.w, w: spot.w - it.w, y: spot.y }] : [];
    sky.splice(i, 1, used, ...rest);
  }
  const height = boxes.reduce((m, b) => Math.max(m, b.y + b.h), 0);
  return { boxes, height };
}
