import { useEffect, useReducer } from "react";
import { relativeTime } from "../utils/time";

// One shared 60s interval powers every consumer widget-wide — a widget with
// a table of timestamps gets one timer, not one per row, and each row only
// re-renders itself (not its parent list) when the tick fires.
type Listener = () => void;
const listeners = new Set<Listener>();
let timer: ReturnType<typeof setInterval> | null = null;

const subscribe = (listener: Listener) => {
  listeners.add(listener);
  timer ??= setInterval(() => {
    for (const l of listeners) l();
  }, 60_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
};

/** Live-updating "3m" / "2h" / "5d" label — ticks itself every minute without a poll/refresh. */
export const useRelativeTime = (epochSeconds: number): string => {
  const [, tick] = useReducer((c: number) => c + 1, 0);
  useEffect(() => subscribe(tick), []);
  return relativeTime(epochSeconds);
};
