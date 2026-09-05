import type { MutableRefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { colsForWidth, type GridItem, repack } from "../grid/math";
import { useGlobalActions, useRegisterGlobalAction } from "../hooks";
import { useNativeMenu } from "../menu/native";
import { toggleModeLabel, toggleWindowedMode } from "../settings/appMode";
import type { SavedPositions } from "./types";

/** Owns the right-click menu (open/close, global actions, F6 "Duplicate"
 * entry data), the tray-mirrored "Reset layout"/Settings/toggle-mode global
 * actions, and the Settings modal's open state + click-through pause. */
export const useDesktopMenu = ({
  monitorIndex,
  windowed,
  widgets,
  saved,
  setClosed,
  isDuplicate,
  layoutRef,
  setLayout,
  savedRef,
  setSaved,
}: {
  monitorIndex: number;
  windowed: boolean;
  widgets: Record<string, unknown>;
  saved: SavedPositions;
  setClosed: (id: string, closed: boolean) => void;
  isDuplicate: (id: string) => boolean;
  layoutRef: MutableRefObject<GridItem[] | null>;
  setLayout: (next: GridItem[]) => void;
  savedRef: MutableRefObject<SavedPositions>;
  setSaved: (next: SavedPositions) => void;
}) => {
  // Right-click menu of global actions. `targetId` is the widget instance
  // whose header was clicked, if any (see openMenu) — what F6's "Duplicate"
  // entry needs to know which folder to duplicate.
  const [menu, setMenu] = useState<{ x: number; y: number; targetId: string | null } | null>(null);
  const menuPos = useRef({ x: 0, y: 0 });
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Scoped to a widget's header (data-widget-header, see widget.tsx) — right-
  // clicking a widget's own body falls through to the normal browser/webview
  // context menu instead (so e.g. pasting into a textarea still works). The
  // menu can extend past the widget's hit-rects, so the click-through poller
  // is paused while it's open (same trick as dragging).
  const openMenu = useCallback((e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest("[data-widget-header]")) return;
    e.preventDefault();
    // Which widget instance's header was clicked, if any — data-widget-id
    // lives on WidgetItem's own root, one level up from the header itself.
    // Only used for F6's "Duplicate" entry below; every other menu entry
    // ignores it.
    const targetId = (e.target as HTMLElement).closest<HTMLElement>("[data-widget-id]")?.dataset.widgetId ?? null;
    menuPos.current = { x: e.clientX, y: e.clientY };
    setMenu({ x: e.clientX, y: e.clientY, targetId });
    invoke("set_drag_active", { active: true }).catch(console.error);
  }, []);
  const closeMenu = useCallback(() => {
    setMenu(null);
    invoke("set_drag_active", { active: false }).catch(console.error);
  }, []);

  // "Reset layout" is a cleanup pass, not a wipe: de-overlap every visible
  // widget and pull anything that drifted off-screen back toward 0,0
  // (repack). Closed/minimized state and per-widget size are left alone — a
  // hidden widget stays hidden, it doesn't reappear. Each monitor runs this
  // against its own widgets (see the wigl-reset listener in
  // useCrossMonitorSync).
  const doReset = useCallback(() => {
    const prev = layoutRef.current;
    if (!prev) return;
    const next = prev.map((i) => ({ ...i }));
    repack(next, colsForWidth(window.innerWidth));
    setLayout(next);
    setSaved({
      ...savedRef.current,
      ...Object.fromEntries(
        next.map((it) => [it.id, { ...savedRef.current[it.id], col: it.col, row: it.row, m: monitorIndex }]),
      ),
    });
  }, [layoutRef, setLayout, savedRef, setSaved, monitorIndex]);

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
  // modal itself is mounted unconditionally by the shell; ThemeEffect (also
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
  // settings/appMode.ts. Reads `windowed` straight from Desktop's own prop
  // (App.tsx's single is_windowed_mode round-trip, already threaded down)
  // rather than re-invoking the command, same single-source-of-truth rule
  // the rest of Desktop follows for it.
  const toggleModeAction = useMemo(
    () => ({
      id: "toggle-mode",
      label: toggleModeLabel(windowed),
      group: "window" as const,
      run: () => {
        toggleWindowedMode(windowed).catch(console.error);
      },
    }),
    [windowed],
  );
  useRegisterGlobalAction(toggleModeAction);
  const globalActions = useGlobalActions();

  // Mirror the right-click menu's actions into the system-tray menu, which
  // stays reachable with every widget closed (the right-click menu needs a
  // widget header to open on) and in both window flows. Primary monitor
  // only — each monitor window is its own JS realm, and only one may drive
  // the single shared tray. `widgetVisibilityEntries` are the per-widget
  // show/hide toggles for the tray's "View" submenu, built here (not via
  // useRegisterGlobalAction) the same way the closed-widget list is
  // rendered straight into the right-click menu by the shell.
  const widgetVisibilityEntries = useMemo(
    () =>
      Object.keys(widgets)
        // F14 — duplicates are session-temporary and erased on close, not
        // hidden, so they never get their own show/hide toggle here.
        .filter((id) => !isDuplicate(id))
        .map((id) => {
          const closed = !!saved[id]?.closed;
          return { id: `view:${id}`, label: id, checked: !closed, run: () => setClosed(id, !closed) };
        }),
    [widgets, saved, setClosed, isDuplicate],
  );
  useNativeMenu({ enabled: monitorIndex === 0, viewEntries: widgetVisibilityEntries });

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

  return {
    menu,
    openMenu,
    closeMenu,
    doReset,
    globalActions,
    settingsOpen,
    setSettingsOpen,
  };
};
