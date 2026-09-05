import type { MutableRefObject, RefObject } from "react";
import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { TILING } from "../grid/config";
import { colToPx, colsForWidth, type GridItem, pxToCol, pxToRow, reflow, rowToPx } from "../grid/math";
import type { DragState, DropMsg, MonitorRect, PreviewMsg, SavedPositions } from "./types";

/** The source side of a cross-monitor drag transaction (see
 * useCrossMonitorSync's doc comment for the full model): owns the drag
 * gesture from pointerdown through drop, including detaching onto a
 * foreign monitor and handing off. */
export const useDragGesture = ({
  els,
  layoutRef,
  setLayout,
  savedRef,
  setSaved,
  persist,
  monitorsRef,
  monitorIndex,
  windowed,
  ghostRef,
  setGhostCell,
  moveFieldCursor,
  showGhost,
  hideGhost,
  wakeField,
  lastActivity,
}: {
  els: MutableRefObject<Record<string, HTMLDivElement | null>>;
  layoutRef: MutableRefObject<GridItem[] | null>;
  setLayout: (next: GridItem[]) => void;
  savedRef: MutableRefObject<SavedPositions>;
  setSaved: (next: SavedPositions) => void;
  persist: (items: GridItem[]) => void;
  monitorsRef: MutableRefObject<MonitorRect[] | null>;
  monitorIndex: number;
  windowed: boolean;
  ghostRef: RefObject<HTMLDivElement | null>;
  setGhostCell: (cell: GridItem | null) => void;
  moveFieldCursor: (x: number, y: number) => void;
  showGhost: (col: number, row: number, w: number, h: number) => void;
  hideGhost: () => void;
  wakeField: (dragging: boolean) => void;
  lastActivity: MutableRefObject<number>;
}) => {
  const drag = useRef<DragState | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      const layout = layoutRef.current;
      if (e.button !== 0 || !layout) return;
      const target = e.target as HTMLElement;
      if (!target.closest("[data-drag-handle]") || target.closest("button, a, input, select, textarea, [data-no-drag]"))
        return;
      const item = layout.find((i) => i.id === id)!;
      const el = els.current[id]!;
      el.setPointerCapture(e.pointerId);
      const own = monitorsRef.current?.[monitorIndex];
      drag.current = {
        id,
        el,
        offX: e.clientX - colToPx(item.col),
        offY: e.clientY - rowToPx(item.row),
        snapshot: layout.map((i) => ({ ...i })),
        target: { mon: monitorIndex, col: item.col, row: item.row },
        frozen: false,
        screenCorrection: {
          x: own ? own.x + e.clientX - e.screenX : 0,
          y: own ? own.y + e.clientY - e.screenY : 0,
        },
      };
      setDragId(id);
      lastActivity.current = Date.now();
      // A fast drag sweeps the pointer across other widgets' content, which
      // is selectable — the browser reads that as "extend a selection" and
      // highlights whatever it passed over. The .dragging class (see the
      // shell's root className) turns selection off desktop-wide for the
      // duration; this clears anything the gesture already managed to
      // select before it applied.
      window.getSelection()?.removeAllRanges();
      setGhostCell({ ...item });
      moveFieldCursor(e.clientX, e.clientY);
      showGhost(item.col, item.row, item.w, item.h);
      wakeField(true);
      // Pause the click-through poller: flipping ignore_cursor_events mid-drag
      // would sever the pointer capture. No poller exists in windowed mode.
      if (!windowed) invoke("set_drag_active", { active: true }).catch(console.error);
    },
    [monitorIndex, windowed, els, layoutRef, monitorsRef, lastActivity, setGhostCell, moveFieldCursor, showGhost, wakeField],
  );

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const layoutNow = layoutRef.current;
    if (!d || !layoutNow) return;
    lastActivity.current = Date.now();
    const item = layoutNow.find((i) => i.id === d.id)!;

    // Which monitor is the cursor on? screenX/Y and the monitor rects share
    // the same global logical space once corrected against d.screenCorrection
    // (see DragState's comment).
    const ms = monitorsRef.current;
    const sx = e.screenX + d.screenCorrection.x;
    const sy = e.screenY + d.screenCorrection.y;
    let tgt = monitorIndex;
    if (ms && !windowed) {
      const hit = ms.findIndex((m) => sx >= m.x && sx < m.x + m.width && sy >= m.y && sy < m.y + m.height);
      if (hit >= 0) tgt = hit;
    }

    if (tgt !== monitorIndex) {
      // Foreign monitor: freeze the card where it is (detached), hand the
      // preview over to the target surface.
      if (!d.frozen) {
        d.frozen = true;
        d.el.classList.add("detached");
        setGhostCell(null);
        hideGhost();
        wakeField(false);
        const reset = d.snapshot.map((i) => ({ ...i })); // undo our local pushes
        layoutRef.current = reset;
        setLayout(reset);
      }
      const m = ms![tgt];
      const fx = sx - m.x - d.offX;
      const fy = sy - m.y - d.offY;
      const cols = colsForWidth(m.width);
      const col = Math.max(0, Math.min(cols - item.w, pxToCol(fx)));
      let row = Math.max(0, pxToRow(fy));
      if (TILING.rows != null) row = Math.min(row, Math.max(0, TILING.rows - item.h));
      d.target = { mon: tgt, col, row };
      emit("wigl-preview", {
        id: d.id,
        to: tgt,
        w: item.w,
        h: item.h,
        col,
        row,
        cx: sx - m.x,
        cy: sy - m.y,
      } satisfies PreviewMsg).catch(console.error);
      return;
    }

    // Home monitor: today's behavior (and a spring back if we were detached).
    if (d.frozen) {
      d.frozen = false;
      d.el.classList.remove("detached");
      wakeField(true);
      showGhost(item.col, item.row, item.w, item.h);
      setGhostCell({ ...item });
      // Tells whichever monitor was previewing to clear.
      emit("wigl-preview", {
        id: d.id,
        to: monitorIndex,
        w: item.w,
        h: item.h,
        col: item.col,
        row: item.row,
        cx: 0,
        cy: 0,
      } satisfies PreviewMsg).catch(console.error);
    }
    moveFieldCursor(e.clientX, e.clientY);
    const fx = e.clientX - d.offX;
    const fy = e.clientY - d.offY;
    d.el.style.transform = `translate(${fx}px, ${fy}px) scale(${TILING.liftScale})`;

    const cols = colsForWidth(window.innerWidth);
    const col = Math.max(0, Math.min(cols - item.w, pxToCol(fx)));
    let row = Math.max(0, pxToRow(fy));
    if (TILING.rows != null) row = Math.min(row, Math.max(0, TILING.rows - item.h));
    d.target = { mon: monitorIndex, col, row };
    if (col === item.col && row === item.row) return;

    // Recompute from the drag-start snapshot each move so cards never drift.
    const next = d.snapshot.map((i) => ({ ...i }));
    const moved = next.find((i) => i.id === d.id)!;
    moved.col = col;
    moved.row = row;
    reflow(next, moved, cols);
    setGhostCell({ ...moved });
    ghostRef.current!.style.transform = `translate(${colToPx(col)}px, ${rowToPx(row)}px)`;

    // Apply pushed positions straight to the DOM — no setState, no Desktop
    // re-render, no reconciliation of widgets nobody touched. CSS owns the
    // settle animation (`.wigl-widget`'s transition in App.css) regardless
    // of whether the transform write comes from here or from React, so this
    // looks identical to the old per-move setLayout, just without the cost.
    // layoutRef is the live source of truth for the rest of the drag; React
    // state (`layout`) only gets one final sync in endDrag, on drop.
    for (const it of next) {
      if (it.id === d.id) continue;
      const el = els.current[it.id];
      if (el) el.style.transform = `translate(${colToPx(it.col)}px, ${rowToPx(it.row)}px)`;
    }
    layoutRef.current = next;
  };

  const endDrag = () => {
    const d = drag.current;
    const layoutNow = layoutRef.current;
    if (!d || !layoutNow) return;
    const item = layoutNow.find((i) => i.id === d.id)!;
    drag.current = null;
    setGhostCell(null);
    setDragId(null); // re-enables the transition; layout effect springs it home
    hideGhost();
    wakeField(false);
    if (!windowed) invoke("set_drag_active", { active: false }).catch(console.error);

    if (d.target.mon !== monitorIndex) {
      // Commit the transfer: the target surface adopts the widget and writes
      // storage; we only let go of it. We still flip our own `saved[d.id].m`
      // right here, though — not just `layout` — because the "missing ids"
      // reconcile effect in useWidgetLayout re-runs off `layout` changing but
      // doesn't depend on `saved` (see its own comment: touching anyone
      // else's saved position isn't its job). Without this, that effect's
      // next pass would still see `saved[d.id].m` pointing at *this*
      // monitor — stale until the target's own `persist()` broadcast
      // round-trips back over `wigl-kv` — and place the widget right back
      // into `items`, since as far as it can tell an id just went missing
      // from a monitor its own saved position still claims. React batches
      // this with the `setLayout` below (same synchronous handler), so the
      // reconcile effect's next run always sees the two agree. This was Bug
      // A (the duplicate left behind on the source monitor) and, downstream
      // of it, Bug B (that duplicate re-placed at TILING.defaultSize because
      // a freshly-placed id has no saved w/h yet) and Bug C (the target's
      // own `wigl-drop` handler bailing out via its "our own local drop"
      // guard because the id had already reappeared in *its* layout too).
      setSaved({
        ...savedRef.current,
        [d.id]: { ...savedRef.current[d.id], m: d.target.mon },
      });
      emit("wigl-drop", {
        id: d.id,
        to: d.target.mon,
        w: item.w,
        h: item.h,
        col: d.target.col,
        row: d.target.row,
      } satisfies DropMsg).catch(console.error);
      d.el.classList.remove("detached");
      const next = layoutNow.filter((i) => i.id !== d.id);
      layoutRef.current = next;
      setLayout(next);
      return;
    }
    emit("wigl-drop", {
      id: d.id,
      to: monitorIndex,
      w: item.w,
      h: item.h,
      col: item.col,
      row: item.row,
    } satisfies DropMsg).catch(console.error);
    // One state sync for the whole gesture: lets the position effect spring
    // the just-dropped card home (dragId is now null) and lets `layout`
    // state — and everything derived from it (hit-rects, persistence) —
    // catch up to the ref that's been the live truth since pointerdown.
    setLayout(layoutNow);
    persist(layoutNow);
  };

  // Stuck-transaction watchdog (see the shell's own interval, which also
  // clears a stale foreign preview): abandon rather than commit, since a
  // stall this long means we don't trust `d.target` any more — spring back
  // to where the drag started.
  const abandonDrag = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    const restored = d.snapshot.map((i) => ({ ...i }));
    layoutRef.current = restored;
    setLayout(restored);
    setGhostCell(null);
    setDragId(null);
    hideGhost();
    wakeField(false);
    d.el.classList.remove("detached");
    if (!windowed) invoke("set_drag_active", { active: false }).catch(console.error);
  }, [windowed, layoutRef, setLayout, setGhostCell, hideGhost, wakeField]);

  return { dragRef: drag, dragId, onPointerDown, onPointerMove, endDrag, abandonDrag };
};
