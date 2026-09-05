import type { GridItem } from "../grid/math";

// Clicks on these inside a drag handle stay clicks; everything else drags.
export const INTERACTIVE = "button, a, input, select, textarea, [data-no-drag]";

// `closed`/`minimized` ride in the same per-id record as position — one
// storage key, one broadcast, no separate sync path to keep in sync with
// drag/drop. `closed` maps straight onto GridItem.hidden (already "not
// rendered, not reflowed, not hit-tested" — see widget.tsx), just driven by
// the header/menu instead of a widget's own report. `w`/`h` are only ever
// written by a resize (see endResize) — a plain drag/drop never touches
// them, unlike col/row/m — so a widget whose author changes its default
// size in code later still picks that new default up for anyone who never
// resized it themselves.
export type SavedPositions = Record<
  string,
  {
    col: number;
    row: number;
    m?: number;
    closed?: boolean;
    minimized?: boolean;
    w?: number;
    h?: number;
  }
>;

export interface MonitorRect {
  x: number;
  y: number;
  width: number;
  height: number;
} // logical px, global (same space as e.screenX/screenY)

export interface DragState {
  id: string;
  el: HTMLDivElement;
  offX: number;
  offY: number;
  snapshot: GridItem[];
  target: { mon: number; col: number; row: number };
  frozen: boolean;
  // `PointerEvent.screenX/screenY` (confirmed live): screenX reports a
  // true global coordinate, but screenY reports a coordinate relative to
  // the *capturing* window's own origin, not the global one, once the
  // drag's pointer capture keeps events flowing after the cursor leaves
  // that window (e.g. onto a monitor at a different y). Calibrated once at
  // drag start from `clientY` (always window-relative, unambiguous) against
  // this window's known global monitor origin, then reused for every move —
  // self-correcting rather than assuming which axis needs it or by how much,
  // so a platform where screenX/Y are already global just calibrates to ~0.
  screenCorrection: { x: number; y: number };
}

// Compass-style handle names, same convention as CSS's nwse-resize/nesw-resize
// cursors: first letter is the row-axis edge (n/s), second is the col-axis
// edge (e/w). A plain edge ("n", "e", ...) touches only its own axis; a
// corner ("ne", "sw", ...) is just both single-axis computations applied in
// the same move — the two axes never share state, so nothing besides
// `onResizeMove`'s edge-matching needed to change to support them.
// `startCol`/`startRow`/`startW`/`startH` are the anchor: every move
// recomputes from these (like DragState.snapshot) so the item never drifts
// across a long gesture. `w`/`e` hold the opposite edge fixed and grow from
// the dragged one; `n`/`s` do the same on the row axis.
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export interface ResizeState {
  id: string;
  edge: ResizeEdge;
  el: HTMLDivElement;
  startX: number;
  startY: number;
  startCol: number;
  startRow: number;
  startW: number;
  startH: number;
  snapshot: GridItem[];
}

/** Broadcast on every drag move while the cursor is on a foreign monitor
 * (and once, with `to: source`, when it returns — which clears everyone). */
export interface PreviewMsg {
  id: string;
  to: number;
  w: number;
  h: number;
  col: number;
  row: number;
  cx: number;
  cy: number;
}

/** Broadcast on drop. The `to` monitor adopts the widget; everyone else
 * discards any preview state. */
export interface DropMsg {
  id: string;
  to: number;
  w: number;
  h: number;
  col: number;
  row: number;
}

// Inset within the widget's own bounds (not overflowing past its edge) so
// they stay inside the click-through hit-rect Rust polls against — a handle
// poking past the grid rect would be unclickable in overlay mode.
export const RESIZE_EDGES: readonly ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
