import { useSyncExternalStore } from "react";
import type { SettingSection } from "./types";

// A registry for widget-contributed Settings sections. Registered once per
// widget at plugin-load time (loader.ts, from a widget's static
// `settingsSection` export) rather than on component mount — a widget's
// section is metadata about that widget (id/label/fields/render), not state
// tied to a live instance, so it stays registered whether or not the widget
// is currently hidden/closed. SettingsModal.tsx merges this with its own
// built-in sections (Appearance, ...) — a widget never needs Desktop.tsx or
// SettingsModal.tsx to change to show up here.

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
 * Registers a widget's Settings section — called once per widget by
 * loader.ts as it loads that widget's plugin module, not by the widget's
 * own component. Idempotent on `section.id` (a plugin reload just replaces
 * the previous registration).
 *
 * `render()` returns the section's own hand-built UI, backed by
 * `useStorage` (Tier 1, live) the same way any other widget state would be
 * — a widget's settings are exactly the kind of thing that should apply
 * instantly, so registering the section ahead of the widget rendering
 * doesn't make its fields any less live once shown.
 */
export const registerSettingsSection = (section: SettingSection): void => {
  sections.set(section.id, section);
  notify();
};

/** The live list of registered (widget-contributed) Settings sections. */
export const useSettingsSections = (): SettingSection[] =>
  useSyncExternalStore(subscribe, snapshot, snapshot);
