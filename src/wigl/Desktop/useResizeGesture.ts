import type { MutableRefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TILING } from "../grid/config";
import { colToPx, colsForWidth, type GridItem, reflow, rowToPx, spanToPx } from "../grid/math";
import type { ResizeEdge, ResizeState, SavedPositions } from "./types";

/** Local to the home monitor only — unlike drag, a resize never hands off
 * to a foreign monitor window; there's no meaningful "resize onto another
 * screen" gesture. Two entry points share this state: a plain click-drag on
 * a handle, and F8's double-click-then-move-then-click ("resizeClickMode"),
 * which arms the same ResizeState but tracks plain window mousemove instead
 * of a captured pointer. */
export const useResizeGesture = ({
  els,
  layoutRef,
  setLayout,
  savedRef,
  setSaved,
  monitorIndex,
  windowed,
}: {
  els: MutableRefObject<Record<string, HTMLDivElement | null>>;
  layoutRef: MutableRefObject<GridItem[] | null>;
  setLayout: (next: GridItem[]) => void;
  savedRef: MutableRefObject<SavedPositions>;
  setSaved: (next: SavedPositions) => void;
  monitorIndex: number;
  windowed: boolean;
}) => {
  const resize = useRef<ResizeState | null>(null);
  const [resizeId, setResizeId] = useState<string | null>(null);
  // F8 — true only for the double-click entry point: the pointer isn't
  // captured/held down (a real click-drag never sets this), so the resize
  // has to track plain window mousemove instead and wait for the next
  // click/Escape to commit/cancel (see the effect below). `resize.current`
  // itself is shared by both entry points — this just says which kind of
  // gesture is currently driving it.
  const [resizeClickMode, setResizeClickMode] = useState(false);

  const makeResizeState = (
    id: string,
    edge: ResizeEdge,
    el: HTMLDivElement,
    clientX: number,
    clientY: number,
  ): ResizeState | null => {
    const layout = layoutRef.current;
    const item = layout?.find((i) => i.id === id);
    if (!layout || !item) return null;
    return {
      id,
      edge,
      el,
      startX: clientX,
      startY: clientY,
      startCol: item.col,
      startRow: item.row,
      startW: item.w,
      startH: item.h,
      snapshot: layout.map((i) => ({ ...i })),
    };
  };

  const onResizeStart = useCallback(
    (e: React.PointerEvent, id: string, edge: ResizeEdge) => {
      if (e.button !== 0) return;
      const el = els.current[id]!;
      const r = makeResizeState(id, edge, el, e.clientX, e.clientY);
      if (!r) return;
      el.setPointerCapture(e.pointerId);
      resize.current = r;
      setResizeId(id);
      window.getSelection()?.removeAllRanges();
      if (!windowed) invoke("set_drag_active", { active: true }).catch(console.error);
    },
    [windowed, els],
  );

  // F8 — the alternative entry point: no pointer capture (double-click has
  // already released the button), so this just arms `resize.current` and
  // flips resizeClickMode on; the effect below does the actual tracking.
  const onResizeDoubleClick = useCallback(
    (e: React.MouseEvent, id: string, edge: ResizeEdge) => {
      const el = els.current[id]!;
      const r = makeResizeState(id, edge, el, e.clientX, e.clientY);
      if (!r) return;
      resize.current = r;
      setResizeId(id);
      setResizeClickMode(true);
      window.getSelection()?.removeAllRanges();
      if (!windowed) invoke("set_drag_active", { active: true }).catch(console.error);
    },
    [windowed, els],
  );

  const onResizeMove = (pos: { clientX: number; clientY: number }, r: ResizeState) => {
    const cols = colsForWidth(window.innerWidth);
    const pitch = TILING.cell + TILING.gap;
    const dCols = Math.round((pos.clientX - r.startX) / pitch);
    const dRows = Math.round((pos.clientY - r.startY) / pitch);
    let col = r.startCol;
    let row = r.startRow;
    let w = r.startW;
    let h = r.startH;
    // Col axis and row axis are independent — a corner handle (e.g. "se")
    // just satisfies both conditions below in the same move.
    if (r.edge.includes("e")) {
      w = Math.max(1, Math.min(cols - r.startCol, r.startW + dCols));
    } else if (r.edge.includes("w")) {
      const rightEdge = r.startCol + r.startW;
      col = Math.max(0, Math.min(rightEdge - 1, r.startCol + dCols));
      w = rightEdge - col;
    }
    if (r.edge.includes("s")) {
      h = Math.max(1, r.startH + dRows);
      if (TILING.rows != null) h = Math.min(h, Math.max(1, TILING.rows - r.startRow));
    } else if (r.edge.includes("n")) {
      const bottomEdge = r.startRow + r.startH;
      row = Math.max(0, Math.min(bottomEdge - 1, r.startRow + dRows));
      h = bottomEdge - row;
    }

    // Recompute from the resize-start snapshot each move, same reasoning as
    // drag's onPointerMove: never accumulate drift across a long gesture.
    const next = r.snapshot.map((i) => ({ ...i }));
    const moved = next.find((i) => i.id === r.id)!;
    moved.col = col;
    moved.row = row;
    moved.w = w;
    moved.h = h;
    reflow(next, moved, cols);
    r.el.style.width = `${spanToPx(moved.w)}px`;
    r.el.style.height = `${spanToPx(moved.h)}px`;
    r.el.style.transform = `translate(${colToPx(moved.col)}px, ${rowToPx(moved.row)}px)`;
    for (const it of next) {
      if (it.id === r.id) continue;
      const el = els.current[it.id];
      if (el) el.style.transform = `translate(${colToPx(it.col)}px, ${rowToPx(it.row)}px)`;
    }
    layoutRef.current = next;
  };

  const endResize = () => {
    const r = resize.current;
    const layoutNow = layoutRef.current;
    if (!r || !layoutNow) return;
    const item = layoutNow.find((i) => i.id === r.id)!;
    resize.current = null;
    setResizeId(null);
    setResizeClickMode(false);
    if (!windowed) invoke("set_drag_active", { active: false }).catch(console.error);
    setLayout(layoutNow);
    // Same col/row/m merge as persist(), plus the resized id's new w/h —
    // one combined write so it doesn't race persist()'s own async setSaved.
    setSaved({
      ...savedRef.current,
      ...Object.fromEntries(
        layoutNow.map((it) => [
          it.id,
          {
            ...savedRef.current[it.id],
            col: it.col,
            row: it.row,
            m: monitorIndex,
            ...(it.id === r.id ? { w: item.w, h: item.h } : {}),
          },
        ]),
      ),
    });
  };

  // F8 — while the double-click entry point is armed, there's no captured
  // pointer to keep delivering move events (unlike the click-drag path),
  // so this listens on window instead: plain movement live-previews via the
  // same onResizeMove used by click-drag, a pointerdown (capture phase, so
  // it runs before whatever it lands on — e.g. starting a fresh drag/resize
  // on the same click) commits via the same endResize, and Escape reverts
  // to the pre-resize snapshot, mirroring the drag watchdog's abandon
  // revert.
  useEffect(() => {
    if (!resizeClickMode) return;
    const onMove = (e: PointerEvent) => {
      const r = resize.current;
      if (r) onResizeMove({ clientX: e.clientX, clientY: e.clientY }, r);
    };
    const onCommit = () => {
      if (resize.current) endResize();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const r = resize.current;
      if (!r) return;
      resize.current = null;
      setResizeId(null);
      setResizeClickMode(false);
      layoutRef.current = r.snapshot;
      setLayout(r.snapshot);
      if (!windowed) invoke("set_drag_active", { active: false }).catch(console.error);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onCommit, { capture: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onCommit, { capture: true });
      window.removeEventListener("keydown", onKeyDown);
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: onResizeMove/endResize close over `resize`/`els`/refs intentionally, same as the original inline effect
  }, [resizeClickMode, windowed]);

  return { resizeRef: resize, resizeId, onResizeStart, onResizeDoubleClick, onResizeMove, endResize };
};
