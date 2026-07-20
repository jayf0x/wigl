// The desktop compositor: one instance per monitor, each a fullscreen
// transparent window rendering the widgets that live on that monitor. Owns
// dragging (pointer events + CSS transforms — no native window moves),
// collision reflow, the drag-time anchor field, layout persistence, and
// hit-rect reporting for the Rust click-through poller.
//
// Cross-monitor drags follow a transaction model: the widget never changes
// ownership until drop. While the cursor is on a foreign monitor the source
// freezes the card ("detached") and broadcasts a preview; the target monitor
// renders the ghost and reflows a phantom. On drop the target adopts the
// widget in one atomic commit; until then only the drag session mutates.

import type { ComponentType, ErrorInfo, ReactNode } from "react";
import { Component, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { availableMonitors } from "@tauri-apps/api/window";
import { TILING } from "./grid/config";
import {
  autoPlace,
  colsForWidth,
  colToPx,
  type GridItem,
  pxToCol,
  pxToRow,
  reflow,
  rowToPx,
  settle,
  spanToPx,
  springEasing,
} from "./grid/math";
import { useGlobalActions, useRegisterGlobalAction, useStorage, useTheme } from "./hooks";
import { ThemeSettingsPopover } from "./ThemeSettingsPopover";
import { getWiglAccent } from "./theme/applyTheme";
import { type WidgetGridReport, WidgetSlotProvider } from "./widget";

// Clicks on these inside a drag handle stay clicks; everything else drags.
const INTERACTIVE = "button, a, input, select, textarea, [data-no-drag]";

type SavedPositions = Record<string, { col: number; row: number; m?: number }>;

interface MonitorRect {
  x: number;
  y: number;
  width: number;
  height: number;
} // logical px, global (same space as e.screenX/screenY)

interface DragState {
  id: string;
  el: HTMLDivElement;
  offX: number;
  offY: number;
  snapshot: GridItem[];
  target: { mon: number; col: number; row: number };
  frozen: boolean;
}

/** Broadcast on every drag move while the cursor is on a foreign monitor
 * (and once, with `to: source`, when it returns — which clears everyone). */
interface PreviewMsg {
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
interface DropMsg {
  id: string;
  to: number;
  w: number;
  h: number;
  col: number;
  row: number;
}

/** Broadcast whenever a monitor persists `widget_layout`, so every other
 * monitor's in-memory `saved` updates immediately instead of waiting up to
 * POLL_MS for the next poll — the window in which two monitors persisting
 * within the same poll interval could otherwise stomp each other's write. */
interface LayoutMsg {
  from: number;
  saved: SavedPositions;
}

// All widgets on a monitor share one React root now, so an uncaught render
// throw in one would otherwise take down every widget on that screen.
class WidgetErrorBoundary extends Component<{ id: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[wigl] widget "${this.props.id}" crashed`, error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 12, fontSize: 11, color: "#fca5a5", overflow: "auto" }}>
          widget "{this.props.id}" crashed: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

export const Desktop = ({
  widgets,
  monitorIndex,
  windowed = false,
}: {
  widgets: Record<string, ComponentType>;
  monitorIndex: number;
  // True on Wayland's single-window flow (see lib.rs's windowed_mode): no
  // sibling monitor windows exist to hand a drag off to, and no click-through
  // poller is reading hit-rects (tried it, reverted — see lib.rs), so both
  // are skipped rather than firing IPC calls nothing listens to.
  windowed?: boolean;
}) => {
  const [saved, setSaved, { loading }] = useStorage<SavedPositions>("widget_layout", {});
  const [layout, setLayout] = useState<GridItem[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // Right-click menu of global actions (see actions.ts), page-px position.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // Where the "Settings" entry was clicked — the settings popover's virtual
  // anchor. A ref, not state off `menu`, since `menu` itself is cleared
  // (closeMenu) by the time the popover would read it.
  const menuPos = useRef({ x: 0, y: 0 });
  const [settingsAt, setSettingsAt] = useState<{ x: number; y: number } | null>(null);
  const [themeId, setThemeId] = useTheme();

  const els = useRef<Record<string, HTMLDivElement | null>>({});
  const ghost = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<DragState | null>(null);
  const cursor = useRef({ x: -1e4, y: -1e4 });
  const ghostCell = useRef<GridItem | null>(null);
  const field = useRef({ alpha: 0, target: 0, raf: 0 });
  const monitors = useRef<MonitorRect[] | null>(null);
  // Incoming cross-monitor preview: snapshot of our layout from before the
  // phantom started pushing things around, restored if the drag leaves.
  const foreign = useRef<{ id: string; w: number; h: number; snapshot: GridItem[] } | null>(null);
  const layoutRef = useRef<GridItem[] | null>(null);
  const savedRef = useRef<SavedPositions>({});
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);

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

  // Every window derives the same ordered monitor list (left-to-right), so a
  // monitor's index is a shared, persistent id.
  useEffect(() => {
    availableMonitors()
      .then((ms) => {
        monitors.current = ms
          .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
          .map((m) => ({
            x: m.position.x / m.scaleFactor,
            y: m.position.y / m.scaleFactor,
            width: m.size.width / m.scaleFactor,
            height: m.size.height / m.scaleFactor,
          }));
      })
      .catch(console.error);
  }, []);

  // Build the layout once storage has answered: this monitor's widgets only
  // (unassigned widgets land on monitor 0). A widget's real size/first-launch
  // position isn't known until its own <Widget w h col row> mounts and
  // reports in (see reportGrid below) — until then it occupies
  // TILING.defaultSize. Positions come from storage first, else first fit.
  useEffect(() => {
    if (loading || layout) return;
    const cols = colsForWidth(window.innerWidth);
    const items: GridItem[] = [];
    for (const id of Object.keys(widgets)) {
      const s = saved[id];
      // Never trust storage blindly: a stale schema or unplugged monitor
      // must degrade to "no saved position", not NaN positions or an
      // orphaned widget (see TODO.md's layout-sanity incident).
      const validPos = s != null && Number.isFinite(s.col) && Number.isFinite(s.row);
      const mon = s != null && Number.isFinite(s.m) && s.m! < (monitors.current?.length ?? Infinity) ? s.m! : 0;
      if (mon !== monitorIndex) continue;
      const { w, h } = TILING.defaultSize;
      const pos = validPos ? s : autoPlace(items, w, h, cols);
      items.push({ id, w, h, col: Math.max(0, Math.min(pos.col, cols - w)), row: Math.max(0, pos.row) });
    }
    // Saved/default positions can conflict after code changes — settle them.
    settle(items);
    setLayout(items);
  }, [loading, layout, saved, widgets, monitorIndex]);

  // A widget's <Widget w h col row> reports its real size (and, the first
  // time it's ever seen with no saved position, its requested first-launch
  // spot) via a layout effect — this fires and settles before paint, so the
  // TILING.defaultSize placeholder above never actually flashes on screen.
  const reportGrid = (id: string, g: WidgetGridReport) => {
    setLayout((prev) => {
      if (!prev) return prev;
      const cur = prev.find((i) => i.id === id);
      if (!cur) return prev;
      const cols = colsForWidth(window.innerWidth);
      const hasSavedPos = savedRef.current[id] != null;
      const col = !hasSavedPos && g.col != null ? Math.max(0, Math.min(g.col, cols - g.w)) : cur.col;
      const row = !hasSavedPos && g.row != null ? Math.max(0, g.row) : cur.row;
      if (cur.w === g.w && cur.h === g.h && cur.col === col && cur.row === row) return prev; // no-op, bail out
      const next = prev.map((i) => (i.id === id ? { ...i, w: g.w, h: g.h, col, row } : { ...i }));
      reflow(next, next.find((i) => i.id === id)!);
      return next;
    });
  };
  // Stable per-id callback identity (so <Widget>'s effect doesn't re-fire on
  // every Desktop render) that always calls the latest reportGrid closure.
  const reportGridRef = useRef(reportGrid);
  reportGridRef.current = reportGrid;
  const slots = useRef<Map<string, (report: WidgetGridReport) => void>>(new Map());
  const getSlot = (id: string) => {
    let slot = slots.current.get(id);
    if (!slot) {
      slot = (report) => reportGridRef.current(id, report);
      slots.current.set(id, slot);
    }
    return slot;
  };

  // Positions are applied imperatively so the dragged card's per-frame inline
  // transform never fights React. CSS transitions animate everyone else.
  useLayoutEffect(() => {
    if (!layout) return;
    for (const it of layout) {
      if (it.id === drag.current?.id) continue;
      const el = els.current[it.id];
      if (el) el.style.transform = `translate(${colToPx(it.col)}px, ${rowToPx(it.row)}px)`;
    }
  }, [layout, dragId]);

  // Tell the Rust cursor poller where our widgets are. During a drag the
  // poller is paused entirely (set_drag_active), so no fullscreen rect games.
  // Windowed mode has no poller (the whole window is already a normal,
  // always-interactive surface), so skip the IPC call entirely.
  useEffect(() => {
    if (!layout || windowed) return;
    const s = window.devicePixelRatio;
    const rects = layout.map((it) => ({
      x: colToPx(it.col) * s,
      y: rowToPx(it.row) * s,
      w: spanToPx(it.w) * s,
      h: spanToPx(it.h) * s,
    }));
    invoke("set_hit_rects", { rects }).catch(console.error);
  }, [layout, windowed]);

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
    const accent = getWiglAccent(); // mirrors the active theme's --wigl-accent
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    for (let cx = 0, x = colToPx(0) - half; x < window.innerWidth - TILING.padding.right + p; cx++, x += p) {
      for (let cy = 0, y = rowToPx(0) - half; y < window.innerHeight - TILING.padding.bottom + p; cy++, y += p) {
        // Anchor reacts to cursor proximity...
        const d = Math.hypot(x - cursor.current.x, y - cursor.current.y);
        const near = d < R ? (1 - d / R) ** 2 : 0;
        // ...and locks in when it's a corner of the drop target.
        const corner = g && (cx === g.col || cx === g.col + g.w) && (cy === g.row || cy === g.row + g.h);
        const t = corner ? 1 : near;
        const arm = 3 + t * 2; // cross arm length: 6px cross swelling to 10px
        const a = f.alpha * (0.1 + t * 0.8);
        if (a < 0.01) continue;
        ctx.globalAlpha = Math.min(a, 1);
        ctx.strokeStyle = t > 0.05 ? accent : "rgb(255 255 255)";
        ctx.lineWidth = 1 + t * 0.5;
        ctx.shadowBlur = t * 6;
        ctx.shadowColor = accent;
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

  const showGhost = (col: number, row: number, w: number, h: number) => {
    const g = ghost.current!;
    g.style.width = `${spanToPx(w)}px`;
    g.style.height = `${spanToPx(h)}px`;
    g.style.transform = `translate(${colToPx(col)}px, ${rowToPx(row)}px)`;
    g.style.opacity = "1";
  };
  const hideGhost = () => {
    ghost.current!.style.opacity = "0";
  };

  const persist = (items: GridItem[]) => {
    const merged = {
      ...savedRef.current,
      ...Object.fromEntries(items.map((it) => [it.id, { col: it.col, row: it.row, m: monitorIndex }])),
    };
    emit("wigl-layout", { from: monitorIndex, saved: merged } satisfies LayoutMsg).catch(console.error);
    setSaved(merged);
  };

  // --- global actions (right-click menu on any widget) -------------------------
  // The menu can extend past the widget's hit-rects, so the click-through
  // poller is paused while it's open (same trick as dragging).
  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    menuPos.current = { x: e.clientX, y: e.clientY };
    setMenu({ x: e.clientX, y: e.clientY });
    invoke("set_drag_active", { active: true }).catch(console.error);
  };
  const closeMenu = () => {
    setMenu(null);
    invoke("set_drag_active", { active: false }).catch(console.error);
  };

  // Reset = wipe all saved positions and rebootstrap every monitor: widgets
  // fall back to monitor 0 + autoPlace + settle, exactly like a first boot.
  const doReset = useCallback(() => {
    setSaved({});
    setLayout(null);
  }, [setSaved]);
  // The only default entry in the right-click menu — a widget wanting its
  // own entry there calls this same hook itself, no Desktop/wigl edit needed.
  // Memoized so the registration effect doesn't re-fire on every render
  // (Desktop re-renders per pointermove during a drag).
  const resetLayoutAction = useMemo(
    () => ({
      id: "reset-layout",
      label: "Reset layout",
      run: () => {
        emit("wigl-reset", { from: monitorIndex }).catch(console.error);
        doReset();
      },
    }),
    [monitorIndex, doReset],
  );
  useRegisterGlobalAction(resetLayoutAction);
  // The central settings entry (Theming part 2) — opens the theme picker
  // anchored at this same right-click point, via useTheme's persisted id.
  const settingsAction = useMemo(
    () => ({
      id: "settings",
      label: "Settings",
      run: () => setSettingsAt({ ...menuPos.current }),
    }),
    [],
  );
  useRegisterGlobalAction(settingsAction);
  const globalActions = useGlobalActions();

  // --- incoming cross-monitor previews / drops ---------------------------------
  useEffect(() => {
    const clearForeign = () => {
      if (!foreign.current) return;
      setLayout(foreign.current.snapshot.map((i) => ({ ...i })));
      foreign.current = null;
      ghostCell.current = null;
      hideGhost();
      wakeField(false);
    };

    const unPreview = listen<PreviewMsg>("wigl-preview", ({ payload: p }) => {
      if (drag.current?.id === p.id) return; // our own broadcast
      if (p.to !== monitorIndex) {
        clearForeign();
        return;
      }
      if (!foreign.current) {
        foreign.current = { id: p.id, w: p.w, h: p.h, snapshot: (layoutRef.current ?? []).map((i) => ({ ...i })) };
        wakeField(true);
      }
      cursor.current = { x: p.cx, y: p.cy };
      const phantom: GridItem = { id: p.id, col: p.col, row: p.row, w: p.w, h: p.h };
      ghostCell.current = phantom;
      const next = [...foreign.current.snapshot.map((i) => ({ ...i })), phantom];
      reflow(next, phantom);
      showGhost(p.col, p.row, p.w, p.h);
      setLayout(next.filter((i) => i.id !== p.id));
    });

    const unLayout = listen<LayoutMsg>("wigl-layout", ({ payload: p }) => {
      if (p.from === monitorIndex) return; // our own broadcast, already applied locally
      setSaved(p.saved);
    });

    const unReset = listen<{ from: number }>("wigl-reset", ({ payload: p }) => {
      if (p.from === monitorIndex) return; // our own broadcast, already applied
      setSaved({});
      setLayout(null);
    });

    const unDrop = listen<DropMsg>("wigl-drop", ({ payload: p }) => {
      if (p.to !== monitorIndex) {
        clearForeign();
        return;
      }
      if (layoutRef.current?.some((i) => i.id === p.id)) return; // our own local drop
      // Adopt: commit the transaction atomically on our surface.
      const base = (foreign.current?.snapshot ?? layoutRef.current ?? []).map((i) => ({ ...i }));
      const item: GridItem = { id: p.id, col: p.col, row: p.row, w: p.w, h: p.h };
      const next = [...base, item];
      reflow(next, item);
      foreign.current = null;
      ghostCell.current = null;
      hideGhost();
      wakeField(false);
      setLayout(next);
      persist(next);
    });

    return () => {
      unPreview.then((u) => u());
      unLayout.then((u) => u());
      unReset.then((u) => u());
      unDrop.then((u) => u());
    };
  }, [monitorIndex]);

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
      offX: e.clientX - colToPx(item.col),
      offY: e.clientY - rowToPx(item.row),
      snapshot: layout.map((i) => ({ ...i })),
      target: { mon: monitorIndex, col: item.col, row: item.row },
      frozen: false,
    };
    setDragId(id);
    ghostCell.current = { ...item };
    cursor.current = { x: e.clientX, y: e.clientY };
    showGhost(item.col, item.row, item.w, item.h);
    wakeField(true);
    // Pause the click-through poller: flipping ignore_cursor_events mid-drag
    // would sever the pointer capture. No poller exists in windowed mode.
    if (!windowed) invoke("set_drag_active", { active: true }).catch(console.error);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !layout) return;
    const item = layout.find((i) => i.id === d.id)!;

    // Which monitor is the cursor on? screenX/Y and the monitor rects share
    // the same global logical space.
    const ms = monitors.current;
    const sx = e.screenX;
    const sy = e.screenY;
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
        ghostCell.current = null;
        hideGhost();
        wakeField(false);
        setLayout(d.snapshot.map((i) => ({ ...i }))); // undo our local pushes
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
      ghostCell.current = { ...item };
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
    cursor.current = { x: e.clientX, y: e.clientY };
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
    reflow(next, moved);
    ghostCell.current = { ...moved };
    ghost.current!.style.transform = `translate(${colToPx(col)}px, ${rowToPx(row)}px)`;
    setLayout(next);
  };

  const endDrag = () => {
    const d = drag.current;
    if (!d || !layout) return;
    const item = layout.find((i) => i.id === d.id)!;
    drag.current = null;
    ghostCell.current = null;
    setDragId(null); // re-enables the transition; layout effect springs it home
    hideGhost();
    wakeField(false);
    if (!windowed) invoke("set_drag_active", { active: false }).catch(console.error);

    if (d.target.mon !== monitorIndex) {
      // Commit the transfer: the target surface adopts the widget and writes
      // storage; we only let go of it.
      emit("wigl-drop", {
        id: d.id,
        to: d.target.mon,
        w: item.w,
        h: item.h,
        col: d.target.col,
        row: d.target.row,
      } satisfies DropMsg).catch(console.error);
      d.el.classList.remove("detached");
      setLayout(layout.filter((i) => i.id !== d.id));
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
    persist(layout);
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
        const Component = widgets[it.id];
        return (
          <div
            key={it.id}
            ref={(el) => {
              els.current[it.id] = el;
            }}
            className={`wigl-widget${dragId === it.id ? " lifted" : ""}`}
            style={{ width: spanToPx(it.w), height: spanToPx(it.h) }}
            onPointerDown={(e) => onPointerDown(e, it.id)}
            onContextMenu={openMenu}
          >
            <WidgetErrorBoundary id={it.id}>
              <WidgetSlotProvider value={getSlot(it.id)}>
                <Suspense fallback={null}>
                  <Component />
                </Suspense>
              </WidgetSlotProvider>
            </WidgetErrorBoundary>
          </div>
        );
      })}
      {menu && (
        <div
          className="wigl-menu-overlay"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) closeMenu();
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="wigl-menu" style={{ left: menu.x, top: menu.y }}>
            {globalActions.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  closeMenu();
                  a.run();
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <ThemeSettingsPopover
        anchor={settingsAt}
        themeId={themeId}
        onSelect={setThemeId}
        onClose={() => setSettingsAt(null)}
      />
    </div>
  );
};
