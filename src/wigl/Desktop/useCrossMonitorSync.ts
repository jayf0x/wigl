import type { MutableRefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { colsForWidth, type GridItem, reflow } from "../grid/math";
import type { DragState, DropMsg, PreviewMsg } from "./types";

/** Cross-monitor drags follow a transaction model: the widget never changes
 * ownership until drop. While the cursor is on a foreign monitor the source
 * freezes the card ("detached") and broadcasts a preview; the target
 * monitor renders the ghost and reflows a phantom. On drop the target
 * adopts the widget in one atomic commit; until then only the drag session
 * mutates. This hook is the *receiving* side of that transaction for any
 * monitor that isn't the drag's own — the source monitor's own drag/drop
 * logic lives in useDragGesture. */
export const useCrossMonitorSync = ({
  monitorIndex,
  layoutRef,
  setLayout,
  doReset,
  persist,
  setGhostCell,
  hideGhost,
  showGhost,
  wakeField,
  moveFieldCursor,
  lastActivity,
  dragRef,
}: {
  monitorIndex: number;
  layoutRef: MutableRefObject<GridItem[] | null>;
  setLayout: (next: GridItem[]) => void;
  doReset: () => void;
  persist: (items: GridItem[]) => void;
  setGhostCell: (cell: GridItem | null) => void;
  hideGhost: () => void;
  showGhost: (col: number, row: number, w: number, h: number) => void;
  wakeField: (dragging: boolean) => void;
  moveFieldCursor: (x: number, y: number) => void;
  lastActivity: MutableRefObject<number>;
  /** The local drag session, if any — so a preview broadcast this same
   * monitor just sent (Tauri echoes emits back to the sender) doesn't get
   * treated as an incoming foreign one. */
  dragRef: MutableRefObject<DragState | null>;
}) => {
  // Incoming cross-monitor preview: snapshot of our layout from before the
  // phantom started pushing things around, restored if the drag leaves.
  const foreign = useRef<{
    id: string;
    w: number;
    h: number;
    snapshot: GridItem[];
  } | null>(null);

  const clearForeign = useCallback(() => {
    if (!foreign.current) return;
    setLayout(foreign.current.snapshot.map((i) => ({ ...i })));
    foreign.current = null;
    setGhostCell(null);
    hideGhost();
    wakeField(false);
  }, [setLayout, setGhostCell, hideGhost, wakeField]);

  useEffect(() => {
    const unPreview = listen<PreviewMsg>("wigl-preview", ({ payload: p }) => {
      if (dragRef.current?.id === p.id) return; // our own broadcast
      if (p.to !== monitorIndex) {
        clearForeign();
        return;
      }
      lastActivity.current = Date.now();
      if (!foreign.current) {
        foreign.current = {
          id: p.id,
          w: p.w,
          h: p.h,
          snapshot: (layoutRef.current ?? []).map((i) => ({ ...i })),
        };
        wakeField(true);
      }
      moveFieldCursor(p.cx, p.cy);
      const phantom: GridItem = {
        id: p.id,
        col: p.col,
        row: p.row,
        w: p.w,
        h: p.h,
      };
      setGhostCell(phantom);
      const next = [...foreign.current.snapshot.map((i) => ({ ...i })), phantom];
      reflow(next, phantom, colsForWidth(window.innerWidth));
      showGhost(p.col, p.row, p.w, p.h);
      setLayout(next.filter((i) => i.id !== p.id));
    });

    const unReset = listen<{ from: number }>("wigl-reset", ({ payload: p }) => {
      if (p.from === monitorIndex) return; // our own broadcast, already applied
      doReset();
    });

    const unDrop = listen<DropMsg>("wigl-drop", ({ payload: p }) => {
      if (p.to !== monitorIndex) {
        clearForeign();
        return;
      }
      if (layoutRef.current?.some((i) => i.id === p.id)) return; // our own local drop
      // Adopt: commit the transaction atomically on our surface.
      const base = (foreign.current?.snapshot ?? layoutRef.current ?? []).map((i) => ({ ...i }));
      const item: GridItem = {
        id: p.id,
        col: p.col,
        row: p.row,
        w: p.w,
        h: p.h,
      };
      const next = [...base, item];
      reflow(next, item, colsForWidth(window.innerWidth));
      foreign.current = null;
      setGhostCell(null);
      hideGhost();
      wakeField(false);
      setLayout(next);
      persist(next);
    });

    return () => {
      unPreview.then((u) => u());
      unReset.then((u) => u());
      unDrop.then((u) => u());
    };
  }, [
    monitorIndex,
    doReset,
    clearForeign,
    layoutRef,
    setLayout,
    persist,
    setGhostCell,
    hideGhost,
    showGhost,
    wakeField,
    moveFieldCursor,
    lastActivity,
    dragRef,
  ]);

  return { foreignRef: foreign, clearForeign };
};
