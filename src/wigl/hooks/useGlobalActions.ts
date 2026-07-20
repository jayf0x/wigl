import { useEffect, useSyncExternalStore } from "react";

// A registry for the desktop's right-click menu (rendered by Desktop.tsx).
// Any component — Desktop itself for defaults like "Reset layout", or a
// widget for something specific to it — calls useRegisterGlobalAction to
// add an entry for as long as it's mounted. Nothing in this file or in
// Desktop.tsx needs to change for a new action to show up.

export interface GlobalAction {
  id: string;
  label: string;
  run: () => void;
}

type Listener = () => void;

const actions = new Map<string, GlobalAction>();
const listeners = new Set<Listener>();

// useSyncExternalStore calls getSnapshot on every render to check for
// changes — it must return a referentially stable result when nothing
// actually changed, or React sees a "new" value every time and loops
// forever (React error #185). Cache the array; only rebuild it on notify().
let cached: GlobalAction[] = [];

const notify = () => {
  cached = [...actions.values()];
  for (const l of listeners) l();
};

const subscribe = (listener: Listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = () => cached;

/** Registers a global action while the calling component is mounted. */
export const useRegisterGlobalAction = (action: GlobalAction) => {
  useEffect(() => {
    actions.set(action.id, action);
    notify();
    return () => {
      actions.delete(action.id);
      notify();
    };
  }, [action]);
};

/** The live list of registered global actions, for rendering a menu. */
export const useGlobalActions = (): GlobalAction[] => useSyncExternalStore(subscribe, snapshot, snapshot);
