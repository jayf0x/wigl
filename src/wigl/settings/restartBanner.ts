// Session-scoped "a Tier-2 field changed" flag — SettingsModal shows a
// restart banner once this flips true, for as long as the process runs.
// Same useSyncExternalStore shape as registry.ts's section list, minus the
// unregister half (nothing ever un-flags it — a Tier-2 write can't be
// un-done by closing the modal).
import { useSyncExternalStore } from "react";

let needed = false;
const listeners = new Set<() => void>();

export const markRestartRequired = () => {
  if (needed) return;
  needed = true;
  for (const l of listeners) l();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useRestartRequired = (): boolean => useSyncExternalStore(subscribe, () => needed);
