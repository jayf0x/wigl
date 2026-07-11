import { useEffect, useReducer } from "react";

// One shared 60s interval powers every consumer widget-wide — a widget with
// a table of timestamps gets one timer, not one per row, and each row only
// re-renders itself (not its parent list) when the tick fires.
type Listener = () => void;
const listeners = new Set<Listener>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: Listener) {
  listeners.add(listener);
  timer ??= setInterval(() => listeners.forEach((l) => l()), 60_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function relativeTime(epochSeconds: number) {
  if (!epochSeconds) return "?";
  const diff = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 604800)}w`;
}

/** Live-updating "3m" / "2h" / "5d" label — ticks itself every minute without a poll/refresh. */
export function useRelativeTime(epochSeconds: number): string {
  const [, tick] = useReducer((c: number) => c + 1, 0);
  useEffect(() => subscribe(tick), []);
  return relativeTime(epochSeconds);
}
