// The desktop compositor: one fullscreen transparent window rendering every
// widget on a tiling grid. Owns dragging (pointer events + CSS transforms —
// no native window moves), collision reflow, the drag-time anchor field,
// layout persistence, and hit-rect reporting for the Rust click-through poller.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { WidgetModule } from "./types";
import { TILING } from "./tiling.config";
import { type GridItem, autoPlace, colToPx, colsForWidth, pxToCol, pxToRow, reflow, rowToPx, spanToPx, springEasing } from "./grid";
import { useStorage } from "./storage";

// Clicks on these inside a drag handle stay clicks; everything else drags.
const INTERACTIVE = "button, a, input, select, textarea, [data-no-drag]";

const ACCENT = { r: 110, g: 231, b: 199 }; // keep in sync with --wigl-accent

type SavedPositions = Record<string, { x: number; y: number }>;

interface DragState {
  id: string;
  el: HTMLDivElement;
  offX: number;
  offY: number;
  snapshot: GridItem[];
}

export function Desktop({ widgets }: { widgets: Record<string, WidgetModule> }) {
  const [saved, setSaved, { loading }] = useStorage<SavedPositions>("widget_layout", {});
  const [layout, setLayout] = useState<GridItem[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const els = useRef<Record<string, HTMLDivElement | null>>({});
  const ghost = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<DragState | null>(null);
  const cursor = useRef({ x: -1e4, y: -1e4 });
  const ghostCell = useRef<GridItem | null>(null);
  const field = useRef({ alpha: 0, target: 0, raf: 0 });

  // Bake the configured spring into a CSS easing once (WKWebView supports
  // linear(); the stylesheet carries a cubic-bezier fallback).
  useEffect(() => {
    if (CSS.supports("transition-timing-function", "linear(0,1)")) {
      document.documentElement.style.setProperty(
        "--wigl-spring",
        springEasing(TILING.spring.stiffness, TILING.spring.damping),
      );
    }
  }, []);

  // Build the layout once storage has answered: sizes always from code
  // (gridConfig), positions from storage, else gridConfig, else first fit.
  useEffect(() => {
    if (loading || layout) return;
    const cols = colsForWidth(window.innerWidth);
    const items: GridItem[] = [];
    for (const [id, mod] of Object.entries(widgets)) {
      const cfg = mod.gridConfig ?? {};
      const w = cfg.w ?? 3;
      const h = cfg.h ?? 4;
      const pos = saved[id] ?? (cfg.x != null && cfg.y != null ? { x: cfg.x, y: cfg.y } : autoPlace(items, w, h, cols));
      items.push({ id, w, h, x: Math.max(0, Math.min(pos.x, cols - w)), y: Math.max(0, pos.y) });
    }
    // Saved/default positions can conflict after code changes — settle them.
    for (const it of items) reflow(items, it);
    setLayout(items);
  }, [loading, layout, saved, widgets]);

  // Positions are applied imperatively so the dragged card's per-frame inline
  // transform never fights React. CSS transitions animate everyone else.
  useLayoutEffect(() => {
    if (!layout) return;
    for (const it of layout) {
      if (it.id === drag.current?.id) continue;
      const el = els.current[it.id];
      if (el) el.style.transform = `translate(${colToPx(it.x)}px, ${rowToPx(it.y)}px)`;
    }
  }, [layout, dragId]);

  // Tell the Rust cursor poller where the widgets are. While dragging, the
  // whole screen is interactive so a fast drag can't outrun the poller.
  useEffect(() => {
    if (!layout) return;
    const s = window.devicePixelRatio;
    const rects = dragId
      ? [{ x: 0, y: 0, w: window.innerWidth * s, h: window.innerHeight * s }]
      : layout.map((it) => ({
          x: colToPx(it.x) * s,
          y: rowToPx(it.y) * s,
          w: spanToPx(it.w) * s,
          h: spanToPx(it.h) * s,
        }));
    invoke("set_hit_rects", { rects }).catch(console.error);
  }, [layout, dragId]);

  // --- anchor field ------------------------------------------------------------
  // Cross marks on every cell corner (centered in the gaps). Idle they're
  // invisible; while dragging they fade in faintly, anchors near the cursor
  // swell toward the accent, and the four corners of the drop target lock in.
  const drawField = () => {
    const cv = canvas.current;
    const f = field.current;
    if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== window.innerWidth * dpr) {
      cv.width = window.innerWidth * dpr;
      cv.height = window.innerHeight * dpr;
    }
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (f.alpha < 0.005 && f.target === 0) {
      f.raf = 0;
      return;
    }
    const p = TILING.cell + TILING.gap;
    const half = TILING.gap / 2;
    const R = TILING.field.influence;
    const g = ghostCell.current;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    for (let cx = 0, x = colToPx(0) - half; x < window.innerWidth - TILING.padding.right + p; cx++, x += p) {
      for (let cy = 0, y = rowToPx(0) - half; y < window.innerHeight - TILING.padding.bottom + p; cy++, y += p) {
        // Anchor reacts to cursor proximity...
        const d = Math.hypot(x - cursor.current.x, y - cursor.current.y);
        const near = d < R ? (1 - d / R) ** 2 : 0;
        // ...and locks in when it's a corner of the drop target.
        const corner = g && (cx === g.x || cx === g.x + g.w) && (cy === g.y || cy === g.y + g.h);
        const t = corner ? 1 : near;
        const arm = 3 + t * 2; // cross arm length: 6px cross swelling to 10px
        const a = f.alpha * (0.1 + t * 0.8);
        if (a < 0.01) continue;
        ctx.globalAlpha = Math.min(a, 1);
        ctx.strokeStyle =
          t > 0.05
            ? `rgb(${ACCENT.r} ${ACCENT.g} ${ACCENT.b})`
            : "rgb(255 255 255)";
        ctx.lineWidth = 1 + t * 0.5;
        ctx.shadowBlur = t * 6;
        ctx.shadowColor = `rgb(${ACCENT.r} ${ACCENT.g} ${ACCENT.b} / 0.8)`;
        ctx.beginPath();
        ctx.moveTo(x - arm, y);
        ctx.lineTo(x + arm, y);
        ctx.moveTo(x, y - arm);
        ctx.lineTo(x, y + arm);
        ctx.stroke();
      }
    }
    ctx.restore();
    f.alpha += (f.target - f.alpha) * 0.12;
    f.raf = requestAnimationFrame(drawField);
  };

  const wakeField = (dragging: boolean) => {
    const { show } = TILING.field;
    if (show === "never") return;
    field.current.target = dragging || show === "always" ? 1 : 0;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) field.current.alpha = field.current.target;
    if (!field.current.raf) field.current.raf = requestAnimationFrame(drawField);
  };
  useEffect(() => {
    wakeField(false); // honor field.show === "always" from boot
    return () => cancelAnimationFrame(field.current.raf);
  }, []);

  // --- drag ------------------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 || !layout) return;
    const target = e.target as HTMLElement;
    if (!target.closest("[data-drag-handle]") || target.closest(INTERACTIVE)) return;
    const item = layout.find((i) => i.id === id)!;
    const el = els.current[id]!;
    el.setPointerCapture(e.pointerId);
    drag.current = {
      id,
      el,
      offX: e.clientX - colToPx(item.x),
      offY: e.clientY - rowToPx(item.y),
      snapshot: layout.map((i) => ({ ...i })),
    };
    setDragId(id);
    ghostCell.current = { ...item };
    cursor.current = { x: e.clientX, y: e.clientY };
    const g = ghost.current!;
    g.style.width = `${spanToPx(item.w)}px`;
    g.style.height = `${spanToPx(item.h)}px`;
    g.style.transform = `translate(${colToPx(item.x)}px, ${rowToPx(item.y)}px)`;
    g.style.opacity = "1";
    wakeField(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !layout) return;
    cursor.current = { x: e.clientX, y: e.clientY };
    const fx = e.clientX - d.offX;
    const fy = e.clientY - d.offY;
    d.el.style.transform = `translate(${fx}px, ${fy}px) scale(${TILING.liftScale})`;
    const item = layout.find((i) => i.id === d.id)!;

    const cols = colsForWidth(window.innerWidth);
    const gx = Math.max(0, Math.min(cols - item.w, pxToCol(fx)));
    let gy = Math.max(0, pxToRow(fy));
    if (TILING.rows != null) gy = Math.min(gy, Math.max(0, TILING.rows - item.h));
    if (gx === item.x && gy === item.y) return;

    // Recompute from the drag-start snapshot each move so cards never drift.
    const next = d.snapshot.map((i) => ({ ...i }));
    const moved = next.find((i) => i.id === d.id)!;
    moved.x = gx;
    moved.y = gy;
    reflow(next, moved);
    ghostCell.current = { ...moved };
    ghost.current!.style.transform = `translate(${colToPx(gx)}px, ${rowToPx(gy)}px)`;
    setLayout(next);
  };

  const endDrag = () => {
    const d = drag.current;
    if (!d || !layout) return;
    drag.current = null;
    ghostCell.current = null;
    setDragId(null); // re-enables the transition; layout effect springs it home
    ghost.current!.style.opacity = "0";
    wakeField(false);
    setSaved(Object.fromEntries(layout.map((it) => [it.id, { x: it.x, y: it.y }])));
  };

  if (!layout) return null;

  return (
    <div className="wigl-desktop" onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <canvas ref={canvas} className="wigl-field" />
      <div ref={ghost} className="wigl-ghost">
        <i />
        <i />
        <i />
        <i />
      </div>
      {layout.map((it) => {
        const Widget = widgets[it.id].default;
        return (
          <div
            key={it.id}
            ref={(el) => {
              els.current[it.id] = el;
            }}
            className={`wigl-widget${dragId === it.id ? " lifted" : ""}`}
            style={{ width: spanToPx(it.w), height: spanToPx(it.h) }}
            onPointerDown={(e) => onPointerDown(e, it.id)}
          >
            <Widget />
          </div>
        );
      })}
    </div>
  );
}
