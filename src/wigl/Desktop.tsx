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
import {
  Component,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { useGlobalActions, useRegisterGlobalAction, useStorage } from "./hooks";
import { generateInstanceId, type WidgetInstances, WIDGET_INSTANCES_KEY } from "./plugins/instances";
import type { WidgetManifest } from "./plugins/types";
import { toggleModeLabel, toggleWindowedMode } from "./settings/appMode";
import { SettingsModal } from "./settings/SettingsModal";
import { sql, sqlLiteral } from "./storage/client";
import { ThemeEffect } from "./theme/ThemeEffect";
import {
  type WidgetGridReport,
  WidgetSlotProvider,
  type WidgetSlotValue,
} from "./widget";

// Clicks on these inside a drag handle stay clicks; everything else drags.
const INTERACTIVE = "button, a, input, select, textarea, [data-no-drag]";

// `closed`/`minimized` ride in the same per-id record as position — one
// storage key, one broadcast, no separate sync path to keep in sync with
// drag/drop. `closed` maps straight onto GridItem.hidden (already "not
// rendered, not reflowed, not hit-tested" — see widget.tsx), just driven by
// the header/menu instead of a widget's own report. `w`/`h` are only ever
// written by a resize (see endResize) — a plain drag/drop never touches
// them, unlike col/row/m — so a widget whose author changes its default
// size in code later still picks that new default up for anyone who never
// resized it themselves.
type SavedPositions = Record<
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
type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface ResizeState {
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

// All widgets on a monitor share one React root now, so an uncaught render
// throw in one would otherwise take down every widget on that screen.
class WidgetErrorBoundary extends Component<
  { id: string; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[wigl] widget "${this.props.id}" crashed`,
      error,
      info.componentStack,
    );
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 12,
            fontSize: 11,
            color: "#fca5a5",
            overflow: "auto",
          }}
        >
          widget "{this.props.id}" crashed: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

// One grid item. Memoized so a drag-triggered `setLayout` on the parent
// doesn't re-render every other widget's subtree — their actual on-screen
// position is already applied imperatively (see the `useLayoutEffect` below
// that writes `transform` directly from `els`), so re-rendering here would
// just be wasted React work chasing a DOM write that already happened.
const RESIZE_EDGES: readonly ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const WidgetItem = memo(function WidgetItem({
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
      // click landed on — see openMenu/F6's "Duplicate" entry below.
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
          />
        ))}
    </div>
  );
});

export const Desktop = ({
  widgets,
  manifests = {},
  background: Background,
  monitorIndex,
  windowed = false,
}: {
  widgets: Record<string, ComponentType>;
  // F6 — per-instance metadata (which folder, whether it can be duplicated
  // again) keyed the same as `widgets`. Defaults to `{}` rather than being
  // required: any caller that hasn't been updated for F6 (a future test, a
  // stale import) just sees every widget as non-duplicatable instead of
  // crashing on a missing prop.
  manifests?: Record<string, WidgetManifest>;
  // The reserved "background" plugin (F11 half 2), if one's installed and
  // loaded — App.tsx threads it straight from loadPlugins()'s result.
  // Renamed on destructure (capitalized) since it's rendered as a component.
  background?: ComponentType;
  monitorIndex: number;
  // True on Wayland's single-window flow (see lib.rs's windowed_mode): no
  // sibling monitor windows exist to hand a drag off to, and no click-through
  // poller is reading hit-rects (tried it, reverted — see lib.rs), so both
  // are skipped rather than firing IPC calls nothing listens to.
  windowed?: boolean;
}) => {
  const [saved, setSaved, { loading }] = useStorage<SavedPositions>(
    "widget_layout",
    {},
  );
  // F11 half 1 — Settings-driven image+opacity background (src/wigl/settings/
  // sections/background.tsx writes both keys live, Tier 1, no restart). Only
  // read/rendered when no `background` plugin (Half 2) is installed — see
  // the render below. ponytail: a data URL in the kv blob is the whole
  // image's bytes, base64-inflated, in one SQLite row — fine for a wallpaper-
  // sized image, a ceiling for anything large (multi-MB blob on every
  // useStorage poll/write). Upgrade path if that ever bites: write the bytes
  // to a file under storageRoot() and store just the path here instead.
  const [backgroundImage] = useStorage<string | null>("wigl_background_image", null);
  const [backgroundOpacity] = useStorage<number>("wigl_background_opacity", 1);
  // F6 — the one core record of which folders have extra ("duplicated")
  // instances beyond their base one (instances.ts owns the shape/key).
  // Same unprefixed, host-level useStorage call as `widget_layout` above —
  // this isn't any one plugin's state, so it doesn't go through the
  // registry's per-plugin key prefix.
  const [instances, setInstances] = useStorage<WidgetInstances>(WIDGET_INSTANCES_KEY, {});
  const [layout, setLayout] = useState<GridItem[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [resizeId, setResizeId] = useState<string | null>(null);
  // Right-click menu of global actions (see actions.ts), page-px position.
  // `targetId` is the widget instance whose header was clicked, if any (see
  // openMenu) — what F6's "Duplicate" entry below needs to know which
  // folder to duplicate.
  const [menu, setMenu] = useState<{ x: number; y: number; targetId: string | null } | null>(null);
  const menuPos = useRef({ x: 0, y: 0 });
  const [settingsOpen, setSettingsOpen] = useState(false);

  const els = useRef<Record<string, HTMLDivElement | null>>({});
  const ghost = useRef<HTMLDivElement>(null);
  const field = useRef<SVGSVGElement>(null);
  const fieldGlow = useRef<SVGCircleElement>(null);
  const [anchors, setAnchors] = useState<
    { col: number; row: number; x: number; y: number }[]
  >([]);
  const drag = useRef<DragState | null>(null);
  const resize = useRef<ResizeState | null>(null);
  const ghostCell = useRef<GridItem | null>(null);
  const monitors = useRef<MonitorRect[] | null>(null);
  // Incoming cross-monitor preview: snapshot of our layout from before the
  // phantom started pushing things around, restored if the drag leaves.
  const foreign = useRef<{
    id: string;
    w: number;
    h: number;
    snapshot: GridItem[];
  } | null>(null);
  const layoutRef = useRef<GridItem[] | null>(null);
  const savedRef = useRef<SavedPositions>({});
  const instancesRef = useRef<WidgetInstances>({});
  // Ids with no saved position yet (true first launch, or a widget added
  // since the last save) — their real size/spot isn't known until they
  // report in, so reflow is deferred until every one of them has reported
  // at least once, then resolved in a single settle() pass. Otherwise the
  // settled layout would depend on mount/report arrival order instead of
  // being deterministic (see backlog).
  const pendingReports = useRef<Set<string>>(new Set());
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);
  useEffect(() => {
    instancesRef.current = instances;
  }, [instances]);

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
  const refreshMonitors = useCallback(
    () =>
      availableMonitors()
        .then((ms) => {
          monitors.current = ms
            .sort(
              (a, b) =>
                a.position.x - b.position.x || a.position.y - b.position.y,
            )
            .map((m) => ({
              x: m.position.x / m.scaleFactor,
              y: m.position.y / m.scaleFactor,
              width: m.size.width / m.scaleFactor,
              height: m.size.height / m.scaleFactor,
            }));
        })
        .catch(console.error),
    [],
  );
  useEffect(() => {
    refreshMonitors();
  }, [refreshMonitors]);

  // lib.rs's monitor poller (windowed mode has no dynamic screen windows, so
  // nothing to reconcile there) broadcasts this when a display is plugged or
  // unplugged. Refresh the monitor list, then rebuild the layout: the build
  // effect below already treats a saved `m` >= the current monitor count as
  // "no assignment" and falls back to monitor 0, so this is what actually
  // migrates a removed monitor's widgets home.
  useEffect(() => {
    if (windowed) return;
    const un = listen("wigl-monitor-count", () => {
      refreshMonitors().then(() => setLayout(null));
    });
    return () => {
      un.then((u) => u());
    };
  }, [windowed, refreshMonitors]);

  // Places one widget id into `items` (mutating it via push, same as the
  // build effect below always did) — factored out so a widget id that
  // appears *after* the initial layout already exists (F6's "duplicate
  // widget": a reload lands a new instance id in `widgets` post-mount) can
  // be placed the same way instead of silently never getting a layout entry.
  const placeItem = (id: string, items: GridItem[], cols: number): void => {
    const s = saved[id];
    // Never trust storage blindly: a stale schema or unplugged monitor
    // must degrade to "no saved position", not NaN positions or an
    // orphaned widget (see docs/debugging.md's storage-shape-drift section).
    const validPos = s != null && Number.isFinite(s.col) && Number.isFinite(s.row);
    const mon =
      s != null && Number.isFinite(s.m) && s.m! < (monitors.current?.length ?? Infinity) ? s.m! : 0;
    if (mon !== monitorIndex) return;
    const validSize = s != null && Number.isFinite(s.w) && Number.isFinite(s.h);
    const w = validSize ? s!.w! : TILING.defaultSize.w;
    const h = validSize ? s!.h! : TILING.defaultSize.h;
    const pos = validPos ? s : autoPlace(items, w, h, cols);
    items.push({
      id,
      w,
      h,
      col: Math.max(0, Math.min(pos.col, cols - w)),
      row: Math.max(0, pos.row),
      hidden: !!s?.closed,
    });
    if (!validPos) pendingReports.current.add(id);
  };

  // Build the layout once storage has answered: this monitor's widgets only
  // (unassigned widgets land on monitor 0). A widget's real size/first-launch
  // position isn't known until its own <Widget w h col row> mounts and
  // reports in (see reportGrid below) — until then it occupies
  // TILING.defaultSize. Positions come from storage first, else first fit.
  useEffect(() => {
    if (loading || layout) return;
    const cols = colsForWidth(window.innerWidth);
    const items: GridItem[] = [];
    pendingReports.current = new Set();
    for (const id of Object.keys(widgets)) placeItem(id, items, cols);
    // Saved/default positions can conflict after code changes — settle them.
    settle(items, cols);
    setLayout(items);
  }, [loading, layout, saved, widgets, monitorIndex]);

  // Reconciles new widget ids that show up *after* the layout above already
  // built — a plain "Reload widgets" or F6's "Duplicate" both land a new id
  // in `widgets` without ever clearing `layout`, so the effect above (gated
  // on `!layout`) never runs again to pick it up. Appends only the missing
  // ids in place, without touching anyone else's position — unlike a full
  // rebuild (setLayout(null)), which would also needlessly re-settle every
  // already-placed widget.
  useEffect(() => {
    if (loading || !layout) return;
    const known = new Set(layout.map((i) => i.id));
    const missing = Object.keys(widgets).filter((id) => !known.has(id));
    if (missing.length === 0) return;
    const cols = colsForWidth(window.innerWidth);
    setLayout((prev) => {
      if (!prev) return prev;
      const items = [...prev];
      for (const id of missing) {
        if (items.some((i) => i.id === id)) continue;
        placeItem(id, items, cols);
      }
      return items;
    });
  }, [loading, layout, widgets, monitorIndex]);

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
      const savedPos = savedRef.current[id];
      const hasSavedPos = savedPos != null;
      // A resized size (savedPos.w/h) wins over the widget's own reported
      // size, same as a dragged col/row wins over its col/row hint — except
      // while minimized, which always forces 1x1 regardless of either.
      const hasSavedSize = savedPos?.w != null && savedPos?.h != null;
      const w = g.minimized ? 1 : hasSavedSize ? savedPos!.w! : g.w;
      const h = g.minimized ? 1 : hasSavedSize ? savedPos!.h! : g.h;
      const col =
        !hasSavedPos && g.col != null
          ? Math.max(0, Math.min(g.col, cols - w))
          : cur.col;
      const row = !hasSavedPos && g.row != null ? Math.max(0, g.row) : cur.row;
      const hidden = !!g.hidden;
      const pending = pendingReports.current;
      if (
        cur.w === w &&
        cur.h === h &&
        cur.col === col &&
        cur.row === row &&
        !!cur.hidden === hidden
      ) {
        pending.delete(id);
        return prev; // no-op, bail out
      }
      const next = prev.map((i) =>
        i.id === id ? { ...i, w, h, col, row, hidden } : { ...i },
      );
      if (pending.has(id)) {
        pending.delete(id);
        // Still waiting on other never-before-seen widgets to report their
        // real size — hold off reflowing so the result doesn't depend on
        // which one happened to report first.
        if (pending.size > 0) return next;
        settle(next, cols);
        return next;
      }
      reflow(
        next,
        next.find((i) => i.id === id)!,
        cols,
      );
      return next;
    });
  };
  // Stable per-id callback identity (so <Widget>'s effect doesn't re-fire on
  // every Desktop render) that always calls the latest reportGrid closure.
  const reportGridRef = useRef(reportGrid);
  reportGridRef.current = reportGrid;

  // Close drives the same GridItem.hidden a widget's own report can set
  // (see widget.tsx's WidgetGridProps) — once hidden, <Component> below
  // isn't rendered at all, so nothing but this setter (or reopening from the
  // menu) can ever bring it back.
  const setClosed = useCallback(
    (id: string, closed: boolean) => {
      setSaved({
        ...savedRef.current,
        [id]: { ...savedRef.current[id], closed },
      });
      setLayout((prev) =>
        prev
          ? prev.map((it) => (it.id === id ? { ...it, hidden: closed } : it))
          : prev,
      );
    },
    [setSaved],
  );
  const toggleMinimize = useCallback(
    (id: string) => {
      const minimized = !savedRef.current[id]?.minimized;
      setSaved({
        ...savedRef.current,
        [id]: { ...savedRef.current[id], minimized },
      });
    },
    [setSaved],
  );

  // One WidgetSlotValue per id, recreated only when its minimized flag
  // actually flips — not on every Desktop render (a drag fires plenty of
  // those), so <Widget>'s effect deps stay stable in between.
  const slots = useRef<
    Map<string, { value: WidgetSlotValue; minimized: boolean }>
  >(new Map());
  const getSlot = (id: string, minimized: boolean): WidgetSlotValue => {
    const cached = slots.current.get(id);
    if (cached && cached.minimized === minimized) return cached.value;
    const value: WidgetSlotValue = {
      report: (report) => reportGridRef.current(id, report),
      minimized,
      onClose: () => setClosed(id, true),
      onToggleMinimize: () => toggleMinimize(id),
    };
    slots.current.set(id, { value, minimized });
    return value;
  };

  // Positions are applied imperatively so the dragged card's per-frame inline
  // transform never fights React. CSS transitions animate everyone else.
  useLayoutEffect(() => {
    if (!layout) return;
    for (const it of layout) {
      if (it.id === drag.current?.id || it.id === resize.current?.id) continue;
      const el = els.current[it.id];
      if (el)
        el.style.transform = `translate(${colToPx(it.col)}px, ${rowToPx(it.row)}px)`;
    }
  }, [layout, dragId, resizeId]);

  // Tell the Rust cursor poller where our widgets are. During a drag the
  // poller is paused entirely (set_drag_active), so no fullscreen rect games.
  // Windowed mode has no poller (the whole window is already a normal,
  // always-interactive surface), so skip the IPC call entirely.
  useEffect(() => {
    if (!layout || windowed) return;
    const s = window.devicePixelRatio;
    const rects = layout
      .filter((it) => !it.hidden)
      .map((it) => ({
        x: colToPx(it.col) * s,
        y: rowToPx(it.row) * s,
        w: spanToPx(it.w) * s,
        h: spanToPx(it.h) * s,
      }));
    invoke("set_hit_rects", { rects }).catch(console.error);
  }, [layout, windowed]);

  // --- anchor field ------------------------------------------------------------
  // Cross marks on every cell corner (centered in the gaps), rendered as SVG
  // paths instead of a canvas redrawn every frame: idle fade and the drop
  // target's corner lock-in are plain CSS (`.wigl-anchor` in App.css), and
  // cursor-proximity brightening is one radial-gradient <circle> whose
  // center tracks the cursor via `cx`/`cy` attribute writes on pointer move
  // — no per-anchor distance math, no RAF loop.
  const buildAnchors = useCallback(() => {
    const p = TILING.cell + TILING.gap;
    const half = TILING.gap / 2;
    const list: { col: number; row: number; x: number; y: number }[] = [];
    for (
      let cx = 0, x = colToPx(0) - half;
      x < window.innerWidth - TILING.padding.right + p;
      cx++, x += p
    ) {
      for (
        let cy = 0, y = rowToPx(0) - half;
        y < window.innerHeight - TILING.padding.bottom + p;
        cy++, y += p
      ) {
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
    const g = fieldGlow.current;
    if (!g) return;
    g.setAttribute("cx", String(x));
    g.setAttribute("cy", String(y));
  }, []);

  // Marks the drop target's four corner anchors so CSS can light them up —
  // called only when the target cell actually changes, not per frame.
  const setGhostCell = useCallback((cell: GridItem | null) => {
    ghostCell.current = cell;
    const svg = field.current;
    if (!svg) return;
    for (const el of svg.querySelectorAll<SVGPathElement>(
      ".wigl-anchor.locked",
    ))
      el.classList.remove("locked");
    if (!cell) return;
    for (const col of [cell.col, cell.col + cell.w]) {
      for (const row of [cell.row, cell.row + cell.h]) {
        svg
          .querySelector<SVGPathElement>(
            `.wigl-anchor[data-col="${col}"][data-row="${row}"]`,
          )
          ?.classList.add("locked");
      }
    }
  }, []);

  const wakeField = useCallback((dragging: boolean) => {
    const { show } = TILING.field;
    if (show === "never") return;
    field.current?.classList.toggle("active", dragging || show === "always");
  }, []);
  useEffect(() => {
    wakeField(false); // honor field.show === "always" from boot
  }, [wakeField]);

  const showGhost = useCallback((col: number, row: number, w: number, h: number) => {
    const g = ghost.current!;
    g.style.width = `${spanToPx(w)}px`;
    g.style.height = `${spanToPx(h)}px`;
    g.style.transform = `translate(${colToPx(col)}px, ${rowToPx(row)}px)`;
    g.style.opacity = "1";
  }, []);
  const hideGhost = useCallback(() => {
    ghost.current!.style.opacity = "0";
  }, []);

  const persist = (items: GridItem[]) => {
    const merged = {
      ...savedRef.current,
      // Spread the existing record first: a plain {col,row,m} here would
      // wipe closed/minimized every time a widget is dragged.
      ...Object.fromEntries(
        items.map((it) => [
          it.id,
          {
            ...savedRef.current[it.id],
            col: it.col,
            row: it.row,
            m: monitorIndex,
          },
        ]),
      ),
    };
    // useStorage's own set() broadcasts this to every other window
    // (`wigl-kv`) — no bespoke layout-specific event needed.
    setSaved(merged);
  };

  // --- global actions (right-click menu on any widget) -------------------------
  // Scoped to a widget's header (data-widget-header, see widget.tsx) — right-
  // clicking a widget's own body falls through to the normal browser/webview
  // context menu instead (so e.g. pasting into a textarea still works). The
  // menu can extend past the widget's hit-rects, so the click-through poller
  // is paused while it's open (same trick as dragging).
  const openMenu = useCallback((e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest("[data-widget-header]")) return;
    e.preventDefault();
    // Which widget instance's header was clicked, if any — data-widget-id
    // lives on WidgetItem's own root (see above), one level up from the
    // header itself. Only used for F6's "Duplicate" entry below; every
    // other menu entry ignores it.
    const targetId =
      (e.target as HTMLElement).closest<HTMLElement>("[data-widget-id]")?.dataset.widgetId ?? null;
    menuPos.current = { x: e.clientX, y: e.clientY };
    setMenu({ x: e.clientX, y: e.clientY, targetId });
    invoke("set_drag_active", { active: true }).catch(console.error);
  }, []);
  const closeMenu = useCallback(() => {
    setMenu(null);
    invoke("set_drag_active", { active: false }).catch(console.error);
  }, []);

  // F6 — "Duplicate widget": records a fresh instance id for `folder` in the
  // one core instances key, then reloads (same broadcast App.tsx's own
  // "Reload widgets" action already uses) so loadPlugins() picks the new
  // instance up on every monitor, not just this one.
  //
  // The row has to actually be in sqlite before that reload fires —
  // loadPlugins() reads this key with a direct, one-shot sql call
  // (loader.ts's readInstances), not through this component's live
  // useStorage state, so there's no live-state shortcut it could otherwise
  // fall back on. `useStorage`'s own set() is fire-and-forget by design
  // (deliberately kept that way — see its own comment on why a Promise
  // return broke `act()` for every existing caller that doesn't await it,
  // same contract as plain useState's setter), so this writes the row
  // directly first, with the exact same sql/sqlLiteral primitives
  // useStorage itself is built on, and only calls setInstances() after —
  // that still gets this window's optimistic state update and the
  // cross-window `wigl-kv` broadcast, just redundantly re-writing a row
  // that's already there (harmless, idempotent).
  const duplicateWidget = useCallback(
    (folder: string) => {
      const newId = generateInstanceId(folder, instancesRef.current[folder] ?? []);
      const next: WidgetInstances = {
        ...instancesRef.current,
        [folder]: [...(instancesRef.current[folder] ?? []), newId],
      };
      const json = JSON.stringify(next);
      sql(
        `INSERT INTO kv (key, value) VALUES (${sqlLiteral(WIDGET_INSTANCES_KEY)}, ${sqlLiteral(json)}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      )
        .catch((e) => console.error(`[wigl] failed to record widget instance "${newId}"`, e))
        .then(() => {
          setInstances(next);
          emit("wigl-reload-widgets").catch(console.error);
        });
    },
    [setInstances],
  );

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
  // The central settings entry — opens the general Settings modal (theme,
  // and whatever else registers a section via useRegisterSettings). The
  // modal itself is mounted unconditionally below; ThemeEffect (also
  // unconditional) is what actually keeps :root's colors in sync regardless
  // of whether the modal is open.
  const settingsAction = useMemo(
    () => ({
      id: "settings",
      label: "Settings",
      run: () => setSettingsOpen(true),
    }),
    [],
  );
  useRegisterGlobalAction(settingsAction);
  // Toggles the overlay/windowed flow via a Tier-2 "app.mode" override
  // (lib.rs's windowed_mode()) and an immediate relaunch — see
  // settings/appMode.ts. Reads `windowed` straight from this component's own
  // prop (App.tsx's single is_windowed_mode round-trip, already threaded
  // down) rather than re-invoking the command, same single-source-of-truth
  // rule the rest of Desktop.tsx follows for it.
  const toggleModeAction = useMemo(
    () => ({
      id: "toggle-mode",
      label: toggleModeLabel(windowed),
      run: () => {
        toggleWindowedMode(windowed).catch(console.error);
      },
    }),
    [windowed],
  );
  useRegisterGlobalAction(toggleModeAction);
  const globalActions = useGlobalActions();

  // The modal can extend past every widget's hit-rect (it's centered over
  // whatever's underneath, not anchored to one), so click-through has to be
  // paused for as long as it's open — same trick openMenu/closeMenu use for
  // the right-click menu. Without this, a click anywhere on the modal
  // (including its own close button) falls through to whatever's behind the
  // window instead of hitting the modal.
  useEffect(() => {
    if (windowed) return;
    invoke("set_drag_active", { active: settingsOpen }).catch(console.error);
  }, [settingsOpen, windowed]);

  // --- incoming cross-monitor previews / drops ---------------------------------
  useEffect(() => {
    const clearForeign = () => {
      if (!foreign.current) return;
      setLayout(foreign.current.snapshot.map((i) => ({ ...i })));
      foreign.current = null;
      setGhostCell(null);
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
      const next = [
        ...foreign.current.snapshot.map((i) => ({ ...i })),
        phantom,
      ];
      reflow(next, phantom, colsForWidth(window.innerWidth));
      showGhost(p.col, p.row, p.w, p.h);
      setLayout(next.filter((i) => i.id !== p.id));
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
      const base = (foreign.current?.snapshot ?? layoutRef.current ?? []).map(
        (i) => ({ ...i }),
      );
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
  }, [monitorIndex]);

  // --- resize ------------------------------------------------------------------
  // Local to the home monitor only — unlike drag, a resize never hands off
  // to a foreign monitor window; there's no meaningful "resize onto another
  // screen" gesture.
  const onResizeStart = useCallback(
    (e: React.PointerEvent, id: string, edge: ResizeEdge) => {
      const layout = layoutRef.current;
      if (e.button !== 0 || !layout) return;
      const item = layout.find((i) => i.id === id)!;
      const el = els.current[id]!;
      el.setPointerCapture(e.pointerId);
      resize.current = {
        id,
        edge,
        el,
        startX: e.clientX,
        startY: e.clientY,
        startCol: item.col,
        startRow: item.row,
        startW: item.w,
        startH: item.h,
        snapshot: layout.map((i) => ({ ...i })),
      };
      setResizeId(id);
      window.getSelection()?.removeAllRanges();
      if (!windowed)
        invoke("set_drag_active", { active: true }).catch(console.error);
    },
    [windowed],
  );

  const onResizeMove = (e: React.PointerEvent, r: ResizeState) => {
    const cols = colsForWidth(window.innerWidth);
    const pitch = TILING.cell + TILING.gap;
    const dCols = Math.round((e.clientX - r.startX) / pitch);
    const dRows = Math.round((e.clientY - r.startY) / pitch);
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
      if (TILING.rows != null)
        h = Math.min(h, Math.max(1, TILING.rows - r.startRow));
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
      if (el)
        el.style.transform = `translate(${colToPx(it.col)}px, ${rowToPx(it.row)}px)`;
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
    if (!windowed)
      invoke("set_drag_active", { active: false }).catch(console.error);
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

  // --- drag ------------------------------------------------------------------
  const onPointerDown = useCallback(
    (e: React.PointerEvent, id: string) => {
      const layout = layoutRef.current;
      if (e.button !== 0 || !layout) return;
      const target = e.target as HTMLElement;
      if (!target.closest("[data-drag-handle]") || target.closest(INTERACTIVE))
        return;
      const item = layout.find((i) => i.id === id)!;
      const el = els.current[id]!;
      el.setPointerCapture(e.pointerId);
      const own = monitors.current?.[monitorIndex];
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
      // A fast drag sweeps the pointer across other widgets' content, which
      // is selectable (see App.css) — the browser reads that as "extend a
      // selection" and highlights whatever it passed over. The .dragging
      // class turns selection off desktop-wide for the duration; this clears
      // anything the gesture already managed to select before it applied.
      window.getSelection()?.removeAllRanges();
      setGhostCell({ ...item });
      moveFieldCursor(e.clientX, e.clientY);
      showGhost(item.col, item.row, item.w, item.h);
      wakeField(true);
      // Pause the click-through poller: flipping ignore_cursor_events mid-drag
      // would sever the pointer capture. No poller exists in windowed mode.
      if (!windowed)
        invoke("set_drag_active", { active: true }).catch(console.error);
    },
    [monitorIndex, windowed, setGhostCell, moveFieldCursor, showGhost, wakeField],
  );

  const onPointerMove = (e: React.PointerEvent) => {
    if (resize.current) {
      onResizeMove(e, resize.current);
      return;
    }
    const d = drag.current;
    const layoutNow = layoutRef.current;
    if (!d || !layoutNow) return;
    const item = layoutNow.find((i) => i.id === d.id)!;

    // Which monitor is the cursor on? screenX/Y and the monitor rects share
    // the same global logical space once corrected against d.screenCorrection
    // (see DragState's comment).
    const ms = monitors.current;
    const sx = e.screenX + d.screenCorrection.x;
    const sy = e.screenY + d.screenCorrection.y;
    let tgt = monitorIndex;
    if (ms && !windowed) {
      const hit = ms.findIndex(
        (m) =>
          sx >= m.x && sx < m.x + m.width && sy >= m.y && sy < m.y + m.height,
      );
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
      if (TILING.rows != null)
        row = Math.min(row, Math.max(0, TILING.rows - item.h));
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
    if (TILING.rows != null)
      row = Math.min(row, Math.max(0, TILING.rows - item.h));
    d.target = { mon: monitorIndex, col, row };
    if (col === item.col && row === item.row) return;

    // Recompute from the drag-start snapshot each move so cards never drift.
    const next = d.snapshot.map((i) => ({ ...i }));
    const moved = next.find((i) => i.id === d.id)!;
    moved.col = col;
    moved.row = row;
    reflow(next, moved, cols);
    setGhostCell({ ...moved });
    ghost.current!.style.transform = `translate(${colToPx(col)}px, ${rowToPx(row)}px)`;

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
      if (el)
        el.style.transform = `translate(${colToPx(it.col)}px, ${rowToPx(it.row)}px)`;
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
    if (!windowed)
      invoke("set_drag_active", { active: false }).catch(console.error);

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
    // state — and everything derived from it (hit-rects, persistence) — catch
    // up to the ref that's been the live truth since pointerdown.
    setLayout(layoutNow);
    persist(layoutNow);
  };

  if (!layout) return null;

  // Every monitor's menu offers every closed widget, not just ones native to
  // this screen — `saved` is shared storage, and reopening resolves the same
  // `m` (monitor) the widget last lived on regardless of which window's menu
  // was used (see the layout-build effect above).
  const closedIds = Object.keys(widgets).filter((id) => saved[id]?.closed);
  // F6 — only offered when the right-clicked header belongs to a widget
  // instance whose folder allows it (package.json's wigl.instantiable,
  // default true — see LocalCode's package.json for a real opt-out and
  // why). `manifests` defaults to `{}` (see the prop above), so an id with
  // no entry there — a caller that hasn't been updated for F6 — is treated
  // as non-duplicatable rather than crashing.
  const duplicateTarget = menu?.targetId ? manifests[menu.targetId] : undefined;

  const onPointerUp = () => {
    if (resize.current) endResize();
    else endDrag();
  };

  return (
    <div
      className={`wigl-desktop${dragId ? " dragging" : ""}${resizeId ? " resizing" : ""}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // Widget dragging is a pointer-event gesture (see onPointerDown), so
      // the browser's own HTML5 drag never does anything useful here — it
      // just renders a translucent snapshot of whatever got grabbed (text,
      // an image, a link) that floats around detached from the grid and
      // drops nowhere. Killing dragstart at the root removes that whole
      // native codepath for every widget at once.
      onDragStart={(e) => e.preventDefault()}
    >
      {/* F11: full-bleed, behind everything else on the desktop — first
          child keeps it lowest in stacking order among the siblings below,
          none of which set a lower explicit z-index (see App.css's
          .wigl-background). A `background` plugin (Half 2) always takes
          precedence over the Settings-driven image (Half 1) when installed;
          nothing renders here if neither is configured. Wrapped in the same
          error boundary a widget gets — an installed plugin's crash here
          shouldn't blank the whole monitor. */}
      {Background ? (
        <WidgetErrorBoundary id="background">
          <div className="wigl-background">
            <Background />
          </div>
        </WidgetErrorBoundary>
      ) : backgroundImage ? (
        <div
          className="wigl-background"
          style={{ backgroundImage: `url(${backgroundImage})`, opacity: backgroundOpacity }}
        />
      ) : null}
      <svg ref={field} className="wigl-field" aria-hidden="true">
        {/* <defs>
          <radialGradient id="wigl-field-glow">
            <stop offset="0%" stopColor="var(--wigl-accent)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--wigl-accent)" stopOpacity="0" />
          </radialGradient>
        </defs> */}
        {anchors.map((a) => (
          <path
            key={`${a.col}-${a.row}`}
            className="wigl-anchor"
            data-col={a.col}
            data-row={a.row}
            d="M -3 0 L 3 0 M 0 -3 L 0 3"
            transform={`translate(${a.x} ${a.y})`}
          />
        ))}
        {/* <circle
          ref={fieldGlow}
          className="wigl-field-glow"
          r={TILING.field.influence}
          cx={-1e4}
          cy={-1e4}
        /> */}
      </svg>
      <div ref={ghost} className="wigl-ghost">
        <i />
        <i />
        <i />
        <i />
      </div>
      {layout.map((it) => {
        if (it.hidden) return null;
        return (
          <WidgetItem
            key={it.id}
            id={it.id}
            Component={widgets[it.id]}
            w={it.w}
            h={it.h}
            lifted={dragId === it.id}
            resizing={resizeId === it.id}
            slot={getSlot(it.id, !!saved[it.id]?.minimized)}
            els={els}
            onPointerDown={onPointerDown}
            onContextMenu={openMenu}
            onResizeStart={onResizeStart}
          />
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
            {duplicateTarget?.instantiable && (
              <>
                <button
                  onClick={() => {
                    closeMenu();
                    duplicateWidget(duplicateTarget.folder);
                  }}
                >
                  Duplicate
                </button>
                <div className="wigl-menu-separator" />
              </>
            )}
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
            {closedIds.length > 0 && (
              <>
                <div className="wigl-menu-separator" />
                {closedIds.map((id) => (
                  <button
                    key={id}
                    onClick={() => {
                      closeMenu();
                      setClosed(id, false);
                    }}
                  >
                    Show {id}
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
      <ThemeEffect />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
};
