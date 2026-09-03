import { type CSSProperties, type PointerEvent as ReactPointerEvent, useRef, useState } from "react";

// Shared pointer drag-to-reorder for a vertical list (the Queue tab and a
// playlist's track list). The DOM row order never changes mid-drag — the
// dragged row and the rows it passes move by CSS transform only — so the
// pointer-captured handle stays put in the tree and WebKit never drops capture
// mid-gesture (the P0.5 bug). The list is frozen to a snapshot for the gesture
// so an incoming refresh can't yank it. `onDrop(from, to)` fires once, on
// release; nothing commits mid-gesture.

const ROW_H_FALLBACK = 42; // used only until we measure a real row

export const useDragReorder = <T>(
  live: T[],
  onDrop: (from: number, to: number, item: T) => void,
) => {
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; dy: number } | null>(
    null,
  );
  const startY = useRef(0);
  const rowH = useRef(ROW_H_FALLBACK);
  const frozen = useRef<T[]>([]);
  if (!drag) frozen.current = live;
  const list = drag ? frozen.current : live;

  const handleFor = (id: string, from: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      startY.current = e.clientY;
      const row = e.currentTarget.closest("[data-reorder-row]") as HTMLElement | null;
      if (row?.offsetHeight) rowH.current = row.offsetHeight;
      setDrag({ id, from, to: from, dy: 0 });
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      setDrag((d) => {
        if (!d) return d;
        const dy = e.clientY - startY.current;
        const to = Math.max(0, Math.min(list.length - 1, d.from + Math.round(dy / rowH.current)));
        return { ...d, dy, to };
      });
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* capture already gone */
      }
      setDrag((d) => {
        if (d && d.to !== d.from) onDrop(d.from, d.to, frozen.current[d.from]);
        return null;
      });
    },
    onPointerCancel: () => setDrag(null),
  });

  const rowShift = (i: number): number => {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.to > drag.from && i > drag.from && i <= drag.to) return -rowH.current;
    if (drag.to < drag.from && i < drag.from && i >= drag.to) return rowH.current;
    return 0;
  };

  const rowStyle = (i: number, id: string): CSSProperties => ({
    transform: `translateY(${rowShift(i)}px)`,
    transition: drag?.id === id ? "none" : "transform 140ms ease",
    position: "relative",
    zIndex: drag?.id === id ? 2 : undefined,
  });

  return {
    /** the list to render — a frozen snapshot while a drag is in progress */
    list,
    handleFor,
    rowStyle,
    isDragging: (id: string) => drag?.id === id,
  };
};
