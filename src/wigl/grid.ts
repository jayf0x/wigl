// Pure tiling math: cell<->px conversion, collision push + gravity compaction
// (react-grid-layout's algorithm without the library), first-fit auto-placement,
// and a damped-spring curve baked into a CSS linear() easing string.
import { TILING } from "./tiling.config";

export interface GridItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const pitch = () => TILING.cell + TILING.gap;

/** Column -> px offset of its left edge. */
export const colToPx = (c: number) => TILING.padding.left + c * pitch();
/** Row -> px offset of its top edge. */
export const rowToPx = (r: number) => TILING.padding.top + r * pitch();
/** Cell span -> px size. */
export const spanToPx = (c: number) => c * TILING.cell + (c - 1) * TILING.gap;
/** Px -> nearest column / row. */
export const pxToCol = (px: number) => Math.round((px - TILING.padding.left) / pitch());
export const pxToRow = (px: number) => Math.round((px - TILING.padding.top) / pitch());

export const colsForWidth = (width: number) =>
  TILING.cols ??
  Math.max(1, Math.floor((width - TILING.padding.left - TILING.padding.right + TILING.gap) / pitch()));

export const collides = (a: GridItem, b: GridItem) =>
  a !== b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Push everything colliding with `moved` downward, then gravity-compact all
 * other items back up. Mutates `items`. */
export function reflow(items: GridItem[], moved: GridItem) {
  const queue = [moved];
  while (queue.length) {
    const m = queue.shift()!;
    for (const it of items) {
      if (it === moved || !collides(it, m)) continue;
      it.y = m.y + m.h;
      queue.push(it);
    }
  }
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const it of sorted) {
    if (it === moved) continue;
    while (it.y > 0) {
      it.y--;
      if (sorted.some((o) => collides(o, it))) {
        it.y++;
        break;
      }
    }
  }
}

/** First open slot scanning left-to-right, top-to-bottom. */
export function autoPlace(placed: GridItem[], w: number, h: number, cols: number) {
  for (let y = 0; ; y++) {
    for (let x = 0; x <= Math.max(0, cols - w); x++) {
      const probe = { id: "", x, y, w, h };
      if (!placed.some((it) => collides(it, probe))) return { x, y };
    }
  }
}

/** Sample a damped spring into a CSS linear() easing so widgets settle with a
 * real bounce on a plain CSS transition — zero JS per frame. */
export function springEasing(stiffness: number, damping: number, samples = 40) {
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * Math.sqrt(stiffness));
  const wd = w0 * Math.sqrt(Math.max(1e-6, 1 - zeta * zeta));
  const dur = 6 / (zeta * w0);
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = (i / samples) * dur;
    const x = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
    pts.push(x.toFixed(4));
  }
  pts[samples] = "1";
  return `linear(${pts.join(",")})`;
}
