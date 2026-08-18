import { useEffect, useSyncExternalStore } from "react";
import type { SettingSection } from "./types";

// A registry for widget-contributed Settings sections, same shape as
// hooks/useGlobalActions.ts's right-click-menu registry: register while
// mounted, unregister on unmount, notify subscribers on every change.
// SettingsModal.tsx merges this with its own built-in sections (Appearance,
// ...) — a widget never needs Desktop.tsx or SettingsModal.tsx to change to
// show up here.

const sections = new Map<string, SettingSection>();
const listeners = new Set<() => void>();

// Same stable-snapshot requirement as useGlobalActions — useSyncExternalStore
// needs a referentially stable array when nothing changed, or React loops.
let cached: SettingSection[] = [];

const notify = () => {
  cached = [...sections.values()];
  for (const l of listeners) l();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = () => cached;

/**
 * Registers a Settings section while the calling component is mounted.
 *
 *   useRegisterSettings({
 *     id: "todo",
 *     label: "Todo",
 *     fields: [{ id: "todo-highlight", label: "Highlight background" }],
 *     render: () => <TodoSettingsSection />,
 *   });
 *
 * Backed by useStorage (Tier 1, live) — a widget's own settings are exactly
 * the kind of thing that should apply instantly, so `render()` should read/
 * write its state the same way the widget's own UI would.
 */
export const useRegisterSettings = (section: SettingSection) => {
  useEffect(() => {
    sections.set(section.id, section);
    notify();
    return () => {
      sections.delete(section.id);
      notify();
    };
  }, [section]);
};

/** The live list of registered (widget-contributed) Settings sections. */
export const useSettingsSections = (): SettingSection[] =>
  useSyncExternalStore(subscribe, snapshot, snapshot);
