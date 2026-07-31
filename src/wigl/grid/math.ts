// Pure tiling math: cell<->px conversion, collision push + gravity compaction
// (react-grid-layout's algorithm without the library), first-fit auto-placement,
// and a damped-spring curve baked into a CSS linear() easing string.
import { TILING } from "./config";

export interface GridItem {
  id: string;
  col: number;
  row: number;
  w: number;
  h: number;
  /** Hidden widgets are skipped entirely: not rendered, and (via `collides`)
   * never block or get pushed by other items' placement. */
  hidden?: boolean;
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
  TILING.cols ?? Math.max(1, Math.floor((width - TILING.padding.left - TILING.padding.right + TILING.gap) / pitch()));

export const collides = (a: GridItem, b: GridItem) =>
  a !== b &&
  !a.hidden &&
  !b.hidden &&
  a.col < b.col + b.w &&
  b.col < a.col + a.w &&
  a.row < b.row + b.h &&
  b.row < a.row + a.h;

/** Push everything colliding with `moved` downward, then fully re-compact
 * every other item into the first free top-left slot (row-major scan) —
 * not just straight up, so a widget fills a horizontal gap instead of every
 * item stacking into one wasted-width column. Mutates `items`. */
export const reflow = (items: GridItem[], moved: GridItem, cols: number) => {
  const queue = [moved];
  while (queue.length) {
    const m = queue.shift()!;
    for (const it of items) {
      if (it === moved || !collides(it, m)) continue;
      it.row = m.row + m.h;
      queue.push(it);
    }
  }
  const placed = [moved];
  const rest = items.filter((it) => it !== moved && !it.hidden).sort((a, b) => a.row - b.row || a.col - b.col);
  for (const it of rest) {
    const pos = autoPlace(placed, it.w, it.h, cols);
    it.col = pos.col;
    it.row = pos.row;
    placed.push(it);
  }
};

/** Settle all items so no two overlap — the reusable cleanup pass run on
 * boot and after a layout reset. Mutates `items`. */
export const settle = (items: GridItem[], cols: number) => {
  for (const it of [...items].sort((a, b) => a.row - b.row || a.col - b.col)) reflow(items, it, cols);
};

/** First open slot scanning left-to-right, top-to-bottom. */
export const autoPlace = (placed: GridItem[], w: number, h: number, cols: number) => {
  for (let row = 0; ; row++) {
    for (let col = 0; col <= Math.max(0, cols - w); col++) {
      const probe = { id: "", col, row, w, h };
      if (!placed.some((it) => collides(it, probe))) return { col, row };
    }
  }
};

/** Sample a damped spring into a CSS linear() easing so widgets settle with a
 * real bounce on a plain CSS transition — zero JS per frame. */
export const springEasing = (stiffness: number, damping: number, samples = 40) => {
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
};
