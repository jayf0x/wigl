// The desktop compositor: one instance per monitor, each a fullscreen
// transparent window rendering the widgets that live on that monitor. Owns
// dragging (pointer events + CSS transforms — no native window moves),
// collision reflow, the drag-time anchor field, layout persistence, and
// hit-rect reporting for the Rust click-through poller.
//
// This file is the composing shell — state/refs shared across more than one
// concern, plus the render. Each gesture/concern lives in its own hook
// alongside this file: useMonitors, useAnchorField, useWidgetLayout,
// useDesktopMenu, useCrossMonitorSync, useResizeGesture, useDragGesture.
// See useCrossMonitorSync's doc comment for the cross-monitor drag
// transaction model those last three cooperate on.
import type { ComponentType } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TILING } from "../grid/config";
import { colToPx, rowToPx, spanToPx, springEasing } from "../grid/math";
import type { WidgetInstances } from "../plugins/instances";
import type { WidgetManifest } from "../plugins/types";
import { SettingsModal } from "../settings/SettingsModal";
import { ThemeEffect } from "../theme/ThemeEffect";
import { WidgetErrorBoundary } from "./WidgetErrorBoundary";
import { WidgetItem } from "./WidgetItem";
import { useMonitors } from "./useMonitors";
import { useAnchorField } from "./useAnchorField";
import { useWidgetLayout } from "./useWidgetLayout";
import { useDesktopMenu } from "./useDesktopMenu";
import { useCrossMonitorSync } from "./useCrossMonitorSync";
import { useResizeGesture } from "./useResizeGesture";
import { useDragGesture } from "./useDragGesture";

export const Desktop = ({
  widgets,
  manifests = {},
  background: Background,
  monitorIndex,
  windowed = false,
  duplicates = {},
  onDuplicatesChange,
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
  // F14 — session-temporary duplicated instances (folder id -> extra
  // instance ids), owned by App.tsx React state. `onDuplicatesChange` both
  // applies the new set locally and broadcasts it to the other monitor
  // windows; Desktop calls it to add a duplicate or erase a closed one.
  // Defaults so a stale/test caller sees no duplicates rather than crashing.
  duplicates?: WidgetInstances;
  onDuplicatesChange?: (next: WidgetInstances) => void;
  // True on Wayland's single-window flow (see lib.rs's windowed_mode): no
  // sibling monitor windows exist to hand a drag off to, and no click-through
  // poller is reading hit-rects (tried it, reverted — see lib.rs), so both
  // are skipped rather than firing IPC calls nothing listens to.
  windowed?: boolean;
}) => {
  const els = useRef<Record<string, HTMLDivElement | null>>({});
  // Defensive backstop, independent of the root-cause fixes in endDrag/
  // useCrossMonitorSync: bumped on every real sign of drag progress (a
  // local pointermove while a drag is live, or an incoming `wigl-preview`
  // while a foreign one is). The watchdog below force-clears a stuck
  // transaction if neither has moved in ~1s — a dropped pointerup/
  // pointercancel (focus stolen mid-drag, an IPC hiccup losing a
  // `wigl-preview`/`wigl-drop`) can otherwise wedge the ghost/field on
  // indefinitely, with no drag actually in progress to ever call
  // endDrag/clearForeign. Not a substitute for those fixes — they prevent
  // the state disagreement from happening; this only bounds how long an
  // *unrelated* stall can leave the overlay visibly wedged.
  const lastActivity = useRef(0);

  const anchorField = useAnchorField();
  const { monitorsRef, refreshMonitors } = useMonitors();

  const layout = useWidgetLayout({
    widgets,
    manifests,
    monitorIndex,
    duplicates,
    onDuplicatesChange,
    buildAnchors: anchorField.buildAnchors,
    monitorsRef,
  });

  // lib.rs's monitor poller (windowed mode has no dynamic screen windows, so
  // nothing to reconcile there) broadcasts this when a display is plugged or
  // unplugged. Refresh the monitor list, then rebuild the layout: the build
  // effect inside useWidgetLayout already treats a saved `m` >= the current
  // monitor count as "no assignment" and falls back to monitor 0, so this is
  // what actually migrates a removed monitor's widgets home.
  useEffect(() => {
    if (windowed) return;
    const un = listen("wigl-monitor-count", () => {
      refreshMonitors().then(() => layout.setLayout(null));
    });
    return () => {
      un.then((u) => u());
    };
  }, [windowed, refreshMonitors, layout.setLayout]);

  const menu = useDesktopMenu({
    monitorIndex,
    windowed,
    widgets,
    saved: layout.saved,
    setClosed: layout.setClosed,
    isDuplicate: layout.isDuplicate,
    layoutRef: layout.layoutRef,
    setLayout: layout.setLayout,
    savedRef: layout.savedRef,
    setSaved: layout.setSaved,
  });

  const drag = useDragGesture({
    els,
    layoutRef: layout.layoutRef,
    setLayout: layout.setLayout,
    savedRef: layout.savedRef,
    setSaved: layout.setSaved,
    persist: layout.persist,
    monitorsRef,
    monitorIndex,
    windowed,
    ghostRef: anchorField.ghostRef,
    setGhostCell: anchorField.setGhostCell,
    moveFieldCursor: anchorField.moveFieldCursor,
    showGhost: anchorField.showGhost,
    hideGhost: anchorField.hideGhost,
    wakeField: anchorField.wakeField,
    lastActivity,
  });

  const resize = useResizeGesture({
    els,
    layoutRef: layout.layoutRef,
    setLayout: layout.setLayout,
    savedRef: layout.savedRef,
    setSaved: layout.setSaved,
    monitorIndex,
    windowed,
  });

  const crossMonitor = useCrossMonitorSync({
    monitorIndex,
    layoutRef: layout.layoutRef,
    setLayout: layout.setLayout,
    doReset: menu.doReset,
    persist: layout.persist,
    setGhostCell: anchorField.setGhostCell,
    hideGhost: anchorField.hideGhost,
    showGhost: anchorField.showGhost,
    wakeField: anchorField.wakeField,
    moveFieldCursor: anchorField.moveFieldCursor,
    lastActivity,
    dragRef: drag.dragRef,
  });

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

  // Positions are applied imperatively so the dragged card's per-frame inline
  // transform never fights React. CSS transitions animate everyone else.
  useLayoutEffect(() => {
    if (!layout.layout) return;
    for (const it of layout.layout) {
      if (it.id === drag.dragRef.current?.id || it.id === resize.resizeRef.current?.id) continue;
      const el = els.current[it.id];
      if (el) el.style.transform = `translate(${colToPx(it.col)}px, ${rowToPx(it.row)}px)`;
    }
  }, [layout.layout, drag.dragId, resize.resizeId]);

  // Tell the Rust cursor poller where our widgets are. During a drag the
  // poller is paused entirely (set_drag_active), so no fullscreen rect games.
  // Windowed mode has no poller (the whole window is already a normal,
  // always-interactive surface), so skip the IPC call entirely.
  useEffect(() => {
    if (!layout.layout || windowed) return;
    const s = window.devicePixelRatio;
    const rects = layout.layout
      .filter((it) => !it.hidden)
      .map((it) => ({
        x: colToPx(it.col) * s,
        y: rowToPx(it.row) * s,
        w: spanToPx(it.w) * s,
        h: spanToPx(it.h) * s,
      }));
    invoke("set_hit_rects", { rects }).catch(console.error);
  }, [layout.layout, windowed]);

  // Stuck-transaction watchdog: if a drag we own, or a foreign preview we're
  // rendering a ghost for, goes quiet for a full second — no local
  // pointermove, no incoming `wigl-preview` — force it closed rather than
  // leaving the anchor field and ghost lit up with no live gesture behind
  // them (a dropped pointerup/pointercancel, a lost IPC message).
  useEffect(() => {
    const id = window.setInterval(() => {
      if (Date.now() - lastActivity.current < 1000) return;
      if (drag.dragRef.current) drag.abandonDrag();
      if (crossMonitor.foreignRef.current) crossMonitor.clearForeign();
    }, 300);
    return () => window.clearInterval(id);
  }, [drag.abandonDrag, crossMonitor.clearForeign]);

  const onPointerMove = (e: React.PointerEvent) => {
    if (resize.resizeRef.current) resize.onResizeMove(e, resize.resizeRef.current);
    else drag.onPointerMove(e);
  };
  const onPointerUp = () => {
    if (resize.resizeRef.current) resize.endResize();
    else drag.endDrag();
  };

  if (!layout.layout) return null;

  // Every monitor's menu offers every closed widget, not just ones native to
  // this screen — `saved` is shared storage, and reopening resolves the same
  // `m` (monitor) the widget last lived on regardless of which window's menu
  // was used (see useWidgetLayout's build effect).
  const closedIds = Object.keys(widgets).filter((id) => layout.saved[id]?.closed);
  // F6 — only offered when the right-clicked header belongs to a widget
  // instance whose folder allows it (package.json's wigl.instantiable,
  // default true — see LocalCode's package.json for a real opt-out and
  // why). `manifests` defaults to `{}`, so an id with no entry there — a
  // caller that hasn't been updated for F6 — is treated as
  // non-duplicatable rather than crashing.
  const duplicateTarget = menu.menu?.targetId ? manifests[menu.menu.targetId] : undefined;

  return (
    <div
      className={`wigl-desktop${drag.dragId ? " dragging" : ""}${resize.resizeId ? " resizing" : ""}`}
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
      ) : layout.backgroundImage ? (
        <div
          className="wigl-background"
          style={{ backgroundImage: `url(${layout.backgroundImage})`, opacity: layout.backgroundOpacity }}
        />
      ) : null}
      <svg ref={anchorField.fieldRef} className="wigl-field" aria-hidden="true">
        {anchorField.anchors.map((a) => (
          <path
            key={`${a.col}-${a.row}`}
            className="wigl-anchor"
            data-col={a.col}
            data-row={a.row}
            d="M -3 0 L 3 0 M 0 -3 L 0 3"
            transform={`translate(${a.x} ${a.y})`}
          />
        ))}
      </svg>
      <div ref={anchorField.ghostRef} className="wigl-ghost">
        <i />
        <i />
        <i />
        <i />
      </div>
      {layout.layout.map((it) => {
        if (it.hidden) return null;
        return (
          <WidgetItem
            key={it.id}
            id={it.id}
            Component={widgets[it.id]}
            w={it.w}
            h={it.h}
            lifted={drag.dragId === it.id}
            resizing={resize.resizeId === it.id}
            slot={layout.getSlot(it.id, !!layout.saved[it.id]?.minimized)}
            els={els}
            onPointerDown={drag.onPointerDown}
            onContextMenu={menu.openMenu}
            onResizeStart={resize.onResizeStart}
            onResizeDoubleClick={resize.onResizeDoubleClick}
          />
        );
      })}
      {menu.menu && (
        <div
          className="wigl-menu-overlay"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) menu.closeMenu();
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {/* Every button below is a bare tag styled entirely by the
              `.wigl-menu button` CSS selector (App.css), not per-instance
              Tailwind classes — wrapping each in the shared Button would
              mean fighting its own baked-in variant styling back off for no
              reuse benefit (this is already the DRY form for a repeated
              plain-text menu item). */}
          <div className="wigl-menu" style={{ left: menu.menu.x, top: menu.menu.y }}>
            {duplicateTarget?.instantiable && (
              <>
                {/* check-style:allow-raw-button — see comment above */}
                <button
                  onClick={() => {
                    menu.closeMenu();
                    layout.duplicateWidget(duplicateTarget.folder);
                  }}
                >
                  Duplicate
                </button>
                <div className="wigl-menu-separator" />
              </>
            )}
            {menu.globalActions.map((a) => (
              // check-style:allow-raw-button — see comment above
              <button
                key={a.id}
                onClick={() => {
                  menu.closeMenu();
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
                  // check-style:allow-raw-button — see comment above
                  <button
                    key={id}
                    onClick={() => {
                      menu.closeMenu();
                      layout.setClosed(id, false);
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
      <SettingsModal open={menu.settingsOpen} onClose={() => menu.setSettingsOpen(false)} />
    </div>
  );
};
