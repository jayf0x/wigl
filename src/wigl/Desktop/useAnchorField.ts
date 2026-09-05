import { useCallback, useEffect, useRef, useState } from "react";
import { TILING } from "../grid/config";
import { colToPx, type GridItem, rowToPx, spanToPx } from "../grid/math";

/** Cross marks on every cell corner (centered in the gaps), rendered as SVG
 * paths instead of a canvas redrawn every frame: idle fade and the drop
 * target's corner lock-in are plain CSS (`.wigl-anchor` in App.css), and
 * cursor-proximity brightening is one radial-gradient `<circle>` whose
 * center tracks the cursor via `cx`/`cy` attribute writes on pointer move —
 * no per-anchor distance math, no RAF loop. Also owns the drag/resize ghost
 * preview element, since both are driven by the same gesture state (drag,
 * resize, and incoming cross-monitor previews all call into this). */
export const useAnchorField = () => {
  const ghostRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<SVGSVGElement>(null);
  const fieldGlowRef = useRef<SVGCircleElement>(null);
  const [anchors, setAnchors] = useState<{ col: number; row: number; x: number; y: number }[]>([]);
  const ghostCell = useRef<GridItem | null>(null);

  const buildAnchors = useCallback(() => {
    const p = TILING.cell + TILING.gap;
    const half = TILING.gap / 2;
    const list: { col: number; row: number; x: number; y: number }[] = [];
    for (let cx = 0, x = colToPx(0) - half; x < window.innerWidth - TILING.padding.right + p; cx++, x += p) {
      for (let cy = 0, y = rowToPx(0) - half; y < window.innerHeight - TILING.padding.bottom + p; cy++, y += p) {
        list.push({ col: cx, row: cy, x, y });
      }
    }
    setAnchors(list);
  }, []);
  useEffect(() => {
    buildAnchors();
    window.addEventListener("resize", buildAnchors);
    return () => window.removeEventListener("resize", buildAnchors);
  }, [buildAnchors]);

  // Moves the proximity glow to the cursor — replaces the old per-frame
  // cursor.current used only by canvas math.
  const moveFieldCursor = useCallback((x: number, y: number) => {
    const g = fieldGlowRef.current;
    if (!g) return;
    g.setAttribute("cx", String(x));
    g.setAttribute("cy", String(y));
  }, []);

  // Marks the drop target's four corner anchors so CSS can light them up —
  // called only when the target cell actually changes, not per frame.
  const setGhostCell = useCallback((cell: GridItem | null) => {
    ghostCell.current = cell;
    const svg = fieldRef.current;
    if (!svg) return;
    for (const el of svg.querySelectorAll<SVGPathElement>(".wigl-anchor.locked")) el.classList.remove("locked");
    if (!cell) return;
    for (const col of [cell.col, cell.col + cell.w]) {
      for (const row of [cell.row, cell.row + cell.h]) {
        svg
          .querySelector<SVGPathElement>(`.wigl-anchor[data-col="${col}"][data-row="${row}"]`)
          ?.classList.add("locked");
      }
    }
  }, []);

  const wakeField = useCallback((dragging: boolean) => {
    const { show } = TILING.field;
    if (show === "never") return;
    fieldRef.current?.classList.toggle("active", dragging || show === "always");
  }, []);
  useEffect(() => {
    wakeField(false); // honor field.show === "always" from boot
  }, [wakeField]);

  const showGhost = useCallback((col: number, row: number, w: number, h: number) => {
    const g = ghostRef.current!;
    g.style.width = `${spanToPx(w)}px`;
    g.style.height = `${spanToPx(h)}px`;
    g.style.transform = `translate(${colToPx(col)}px, ${rowToPx(row)}px)`;
    g.style.opacity = "1";
  }, []);
  const hideGhost = useCallback(() => {
    ghostRef.current!.style.opacity = "0";
  }, []);

  return {
    ghostRef,
    fieldRef,
    fieldGlowRef,
    anchors,
    buildAnchors,
    moveFieldCursor,
    setGhostCell,
    wakeField,
    showGhost,
    hideGhost,
  };
};
