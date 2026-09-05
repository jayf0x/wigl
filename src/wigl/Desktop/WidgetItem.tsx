import type { ComponentType } from "react";
import { memo, Suspense, useCallback } from "react";
import { spanToPx } from "../grid/math";
import { type WidgetSlotValue, WidgetSlotProvider } from "../widget";
import { WidgetErrorBoundary } from "./WidgetErrorBoundary";
import { RESIZE_EDGES, type ResizeEdge } from "./types";

// One grid item. Memoized so a drag-triggered `setLayout` on the parent
// doesn't re-render every other widget's subtree — their actual on-screen
// position is already applied imperatively (see the `useLayoutEffect` in
// Desktop.tsx that writes `transform` directly from `els`), so re-rendering
// here would just be wasted React work chasing a DOM write that already
// happened.
export const WidgetItem = memo(function WidgetItem({
  id,
  Component,
  w,
  h,
  lifted,
  resizing,
  slot,
  els,
  onPointerDown,
  onContextMenu,
  onResizeStart,
  onResizeDoubleClick,
}: {
  id: string;
  Component: ComponentType;
  w: number;
  h: number;
  lifted: boolean;
  resizing: boolean;
  slot: WidgetSlotValue;
  els: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.PointerEvent, id: string, edge: ResizeEdge) => void;
  onResizeDoubleClick: (e: React.MouseEvent, id: string, edge: ResizeEdge) => void;
}) {
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      els.current[id] = el;
    },
    [els, id],
  );
  return (
    <div
      ref={setRef}
      // Host-owned marker (not part of the widget-author contract) so the
      // desktop's own right-click handler can tell which widget instance a
      // click landed on — see openMenu/F6's "Duplicate" entry in Desktop.tsx.
      data-widget-id={id}
      className={`wigl-widget${lifted ? " lifted" : ""}${resizing ? " resizing" : ""}`}
      style={{ width: spanToPx(w), height: spanToPx(h) }}
      onPointerDown={(e) => onPointerDown(e, id)}
      onContextMenu={onContextMenu}
    >
      <WidgetErrorBoundary id={id}>
        <WidgetSlotProvider value={slot}>
          <Suspense fallback={null}>
            <Component />
          </Suspense>
        </WidgetSlotProvider>
      </WidgetErrorBoundary>
      {/* Inset within the widget's own bounds (not overflowing past its edge)
          so they stay inside the click-through hit-rect Rust polls against —
          a handle poking past the grid rect would be unclickable in overlay
          mode. Skipped while minimized: a 1x1 tile has nothing to resize. */}
      {!slot.minimized &&
        RESIZE_EDGES.map((edge) => (
          <div
            key={edge}
            data-resize-handle={edge}
            className={`wigl-resize-handle wigl-resize-${edge}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              onResizeStart(e, id, edge);
            }}
            // F8 — double-clicking a handle is a second entry point into
            // resize: instead of requiring the drag to stay held down, it
            // arms a "resize mode" (see resizeClickMode in useResizeGesture)
            // that tracks plain mouse movement and commits on the next click.
            onDoubleClick={(e) => {
              e.stopPropagation();
              onResizeDoubleClick(e, id, edge);
            }}
          />
        ))}
    </div>
  );
});
