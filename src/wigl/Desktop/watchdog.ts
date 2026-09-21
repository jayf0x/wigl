// Stuck-transaction watchdog for the drag/foreign-preview gestures (see
// Desktop.tsx). A dropped pointerup, or a lost `wigl-preview`/`wigl-drop`
// IPC message, can leave the ghost/anchor field wedged on with no gesture
// behind it; if nothing has reported progress for `staleMs`, `onStale`
// force-closes it.
//
// Self-arming rather than a permanent interval: a 24/7 app shouldn't wake
// every 300ms per window for a gesture that happens a few times a day. The
// invariant that makes this safe: every way a transaction can *start or
// progress* calls `touch()` (drag pointerdown, each local pointermove, each
// incoming preview), and `touch()` arms the timer — so an active transaction
// always has a timer behind it. The timer disarms only by observing
// `isActive() === false`, and the next `touch()` re-arms it.
export interface Watchdog {
  /** Records progress and makes sure the timer is running. */
  touch: () => void;
  /** Stops the timer (unmount). Safe to `touch()` again afterwards. */
  dispose: () => void;
}

export interface WatchdogOptions {
  /** Is a drag or foreign preview currently open? Read fresh on every tick. */
  isActive: () => boolean;
  /** Force-close whatever is open. */
  onStale: () => void;
  staleMs?: number;
  tickMs?: number;
  // Injectable for tests (a manual clock beats sleeping through real time).
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const createWatchdog = ({
  isActive,
  onStale,
  staleMs = 1000,
  tickMs = 300,
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}: WatchdogOptions): Watchdog => {
  let last = 0;
  let timer: unknown = null;

  const tick = () => {
    timer = null;
    if (!isActive()) return; // nothing to watch: stay disarmed until the next touch()
    if (now() - last >= staleMs) onStale();
    // Still open after a stale-close (or not stale yet): keep watching.
    if (isActive()) timer = setTimer(tick, tickMs);
  };

  return {
    touch: () => {
      last = now();
      timer ??= setTimer(tick, tickMs);
    },
    dispose: () => {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
};
