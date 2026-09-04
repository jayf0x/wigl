import {
  CheckMenuItem,
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
} from "@tauri-apps/api/menu";
import { TrayIcon } from "@tauri-apps/api/tray";
import { useEffect, useMemo } from "react";
import { type GlobalAction, useGlobalActions } from "../hooks/useGlobalActions";

// Must match TRAY_ID in src-tauri/src/lib.rs. Rust creates the tray icon
// with a minimal fallback menu (just Quit, so it works even if the webview
// never loads); this module looks the icon up and swaps that menu for one
// built from the live useGlobalActions registry — the same list the
// desktop's right-click menu renders. They stay in sync by construction,
// not by a test asserting two hand-kept lists match.
const TRAY_ID = "wigl";

export interface MenuEntry {
  id: string;
  label: string;
  /** Omit for a plain item; set for a checkbox item (widget visibility). */
  checked?: boolean;
  run: () => void;
}

interface Model {
  /** Tray-menu root — registry actions with no `group` (Settings, Reload
   * widgets, Reset layout: the common case). */
  root: MenuEntry[];
  view: MenuEntry[];
  window: MenuEntry[];
}

const buildModel = (actions: GlobalAction[], viewEntries: MenuEntry[]): Model => {
  const model: Model = { root: [], view: [...viewEntries], window: [] };
  for (const a of actions) {
    const entry: MenuEntry = { id: a.id, label: a.label, run: a.run };
    if (a.group === "view") model.view.push(entry);
    else if (a.group === "window") model.window.push(entry);
    else model.root.push(entry);
  }
  return model;
};

// A stable string of everything that changes the menu's appearance. The
// effect rebuilds only when this changes, not on every Desktop re-render (a
// drag fires plenty) where the registry and the visibility flags are
// untouched.
const signatureOf = (m: Model): string =>
  JSON.stringify(
    (["root", "view", "window"] as const).map((k) =>
      m[k].map((e) => [e.id, e.label, e.checked ?? null]),
    ),
  );

type Item = MenuItem | CheckMenuItem | Submenu | PredefinedMenuItem;

const toItem = (e: MenuEntry): Promise<MenuItem | CheckMenuItem> =>
  e.checked === undefined
    ? MenuItem.new({ id: e.id, text: e.label, action: () => e.run() })
    : CheckMenuItem.new({
        id: e.id,
        text: e.label,
        checked: e.checked,
        action: () => e.run(),
      });

const buildMenu = async (m: Model): Promise<Menu> => {
  const items: Item[] = [];
  for (const e of m.root) items.push(await toItem(e));
  for (const [label, entries] of [
    ["View", m.view],
    ["Window", m.window],
  ] as const) {
    if (entries.length === 0) continue;
    items.push(
      await Submenu.new({ text: label, items: await Promise.all(entries.map(toItem)) }),
    );
  }
  items.push(await PredefinedMenuItem.new({ item: "Separator" }));
  items.push(await PredefinedMenuItem.new({ item: "Quit", text: "Quit wigl" }));
  return Menu.new({ items });
};

// Last menu handed to the tray — closed once its replacement is in place so
// a long session of toggling widgets doesn't leak a Rust-side menu resource
// per rebuild. Module-level, not a ref: there is exactly one tray, and the
// caller's guard means exactly one realm ever drives it.
let activeMenu: Menu | null = null;

/**
 * Mirrors the useGlobalActions registry into the system-tray menu. Call
 * unconditionally; it no-ops unless `enabled`. The caller enables it on the
 * primary monitor only — each monitor window is its own JS realm with its
 * own registry, and only one may own the shared tray.
 *
 * `viewEntries` are the per-widget show/hide toggles, passed in rather than
 * pulled from the registry: they're too numerous and too dynamic to
 * register one action each, the same reason Desktop renders its
 * closed-widget list into the right-click menu directly.
 */
export const useNativeMenu = ({
  enabled,
  viewEntries,
}: {
  enabled: boolean;
  viewEntries: MenuEntry[];
}): void => {
  const actions = useGlobalActions();
  const model = useMemo(() => buildModel(actions, viewEntries), [actions, viewEntries]);
  const signature = signatureOf(model);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;

    buildMenu(model)
      .then(async (menu) => {
        if (disposed) return void menu.close();
        const tray = await TrayIcon.getById(TRAY_ID);
        if (!tray) {
          console.error("[wigl] tray icon not found — menu not synced");
          void menu.close();
          return;
        }
        await tray.setMenu(menu);
        const prev = activeMenu;
        activeMenu = menu;
        // Only after the tray points at the new menu — closing it while
        // it's still the displayed menu would blank the tray briefly.
        if (prev) prev.close().catch(() => {});
      })
      .catch((e) => console.error("[wigl] native menu sync failed", e));

    return () => {
      disposed = true;
    };
    // `model` is a fresh object every render; `signature` is the real
    // trigger and captures every field buildMenu reads from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, signature]);
};
