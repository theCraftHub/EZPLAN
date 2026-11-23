/** Small helpers for drawing only what's on screen. */
import { useEffect, useState, type RefObject } from "react";

/** True on desktop-width screens (the lg breakpoint), updating when the window is resized. */
export function useIsDesktop(): boolean {
  const q = "(min-width: 1024px)";
  const [on, setOn] = useState(() => typeof matchMedia !== "undefined" && matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const f = () => setOn(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return on;
}

/** Which columns of a sideways-scrolling box are in view (plus a margin), by fixed column width. */
export function useVisibleColumns(ref: RefObject<HTMLElement | null>, count: number, colWidth: number, leftOffset: number, overscan = 6) {
  const [range, setRange] = useState<[number, number]>([0, Math.min(count, 40)]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const first = Math.max(0, Math.floor((el.scrollLeft - leftOffset) / colWidth) - overscan);
      const last = Math.min(count, Math.ceil((el.scrollLeft + el.clientWidth) / colWidth) + overscan);
      setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      removeEventListener("resize", update);
    };
  }, [ref, count, colWidth, leftOffset, overscan]);
  return range;
}

/** Which rows of a tall list are in view of the window, given each row's top and the list's height. */
export function useVisibleRows(ref: RefObject<HTMLElement | null>, tops: number[], total: number, overscanPx = 600) {
  const [range, setRange] = useState<[number, number]>([0, Math.min(tops.length, 60)]);
  useEffect(() => {
    const update = () => {
      const el = ref.current;
      if (!el) return;
      const y0 = -el.getBoundingClientRect().top - overscanPx;
      const y1 = y0 + innerHeight + overscanPx * 2;
      let first = 0;
      while (first < tops.length - 1 && tops[first + 1]! < y0) first++;
      let last = first;
      while (last < tops.length && tops[last]! < y1) last++;
      setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
    };
    update();
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    return () => {
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
    };
  }, [ref, tops, total, overscanPx]);
  return range;
}
