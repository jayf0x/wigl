import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/wigl/utils";
import type { MusicApi } from "../../useMusic";
import { SCRUBBER_TICK_MS } from "../../music.config";
import { fmt, fmtSpeed } from "./format";

/** The old per-frame glide factor (0.12/frame at 60fps), kept as a decay so the drift correction feels the same at any tick rate. */
const GLIDE_DECAY_PER_FRAME = 0.88;

/** Click / drag the timeline to seek. Frozen to the drag position while the
 * pointer is down; snaps back to the live `elapsed` on release + reconcile. */
export const Scrubber = ({ api }: { api: MusicApi }) => {
  const { now } = api;
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null); // fraction 0..1 while dragging
  const duration = now?.duration ?? 0;

  // Smooth clock (A2): a JS counter that advances by real elapsed time (×
  // playback speed) so the label ticks continuously instead of stepping on
  // MA's sparse `queue_time_updated` (~1 event / several seconds). Each
  // `SCRUBBER_TICK_MS` it reconciles with `api.getProgress()`: a big delta
  // snaps + fires an LED blink (`.mx-sync`) on the time label — the "synth"
  // flourish; a small one (<0.35s drift) glides in silently. Radio ("live")
  // skips all of this.
  //
  // The bar does NOT animate in JS. Each tick hands CSS an optimistic target
  // — where the clock will be one tick from now — and a linear `transition`
  // (slightly longer than the tick, so a late tick never stalls it) does the
  // per-frame work on the compositor. The next tick retargets from wherever
  // the bar is, which is also how corrections stay smooth: a drift fix or a
  // seek is just a different target, never a snap.
  const [live, setLive] = useState<number | null>(null);
  const [ahead, setAhead] = useState<number | null>(null); // clock position one tick from now
  const [syncKey, setSyncKey] = useState(0);
  const posRef = useRef(0);
  const playing = !!now?.playing && !now?.isRadio;
  const trackKey = now?.title ?? "";
  // The tick effect must not restart when `api` changes identity (it does on
  // almost every state change) — a restarting interval would never fire.
  const apiRef = useRef(api);
  apiRef.current = api;
  const tickRef = useRef<() => void>(() => {});
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the counter on track change
  useEffect(() => {
    posRef.current = now?.elapsed ?? 0;
    setLive(posRef.current);
  }, [trackKey]);
  useEffect(() => {
    if (!playing) {
      setLive(null);
      setAhead(null);
      tickRef.current = () => {};
      return;
    }
    let last = performance.now();
    const tick = () => {
      const t = performance.now();
      const dt = Math.max(0, (t - last) / 1000);
      last = t;
      // `api.getProgress()` projects the playhead forward from the seek target
      // (hook-side) until the SDK clock catches up, so this never snaps
      // backward on a scrub even through a long rebuffer (P0.3).
      const p = apiRef.current.getProgress();
      const rate = p?.playbackSpeed && p.playbackSpeed > 0 ? p.playbackSpeed : 1;
      posRef.current += dt * rate;
      if (p && p.position > 0) {
        const diff = p.position - posRef.current;
        if (Math.abs(diff) > 0.35) {
          posRef.current = p.position;
          setSyncKey((k) => k + 1); // replay .mx-sync
        } else if (Math.abs(diff) > 0.02) {
          posRef.current += diff * (1 - GLIDE_DECAY_PER_FRAME ** (dt * 60)); // glide, frame-rate independent
        }
      }
      setLive(posRef.current);
      setAhead(posRef.current + (rate * SCRUBBER_TICK_MS) / 1000);
    };
    tickRef.current = tick;
    tick(); // start gliding now, not a full tick from now
    const id = setInterval(tick, SCRUBBER_TICK_MS);
    return () => clearInterval(id);
  }, [playing]);
  const elapsed = drag == null ? (live ?? now?.elapsed ?? 0) : now?.elapsed ?? 0;

  const fracFromEvent = (e: ReactPointerEvent | PointerEvent) => {
    const el = barRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!now || now.isRadio || duration <= 0) return;
    e.preventDefault(); // P3.2 — no text selection on a scrub
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(fracFromEvent(e));
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag == null) return;
    setDrag(fracFromEvent(e));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag == null) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const target = drag * duration;
    api.seek(target);
    setLive(target);
    setDrag(null);
    // Tick now: reconciles against the seek (snap + `.mx-sync` blink, as it
    // always did) and resumes the bar's glide from the seek point instead of
    // holding still until the next tick. A no-op while paused.
    tickRef.current();
  };

  const frac = duration > 0 ? Math.min(1, Math.max(0, (drag ?? (ahead ?? elapsed) / duration))) : 0;
  const barTransition = drag != null ? "none" : `transform ${Math.round(SCRUBBER_TICK_MS * 1.1)}ms linear`;
  const shownElapsed = drag != null ? drag * duration : elapsed;
  const seekable = !!now && !now.isRadio && duration > 0;

  return (
    <div className="mx-nodrag-select flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums">
      <span key={syncKey} className={cn("w-8", syncKey > 0 && drag == null && "mx-sync")}>
        {now?.isRadio ? "live" : fmt(shownElapsed)}
      </span>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven scrubber, keyboard seek is on the widget root */}
      <div
        ref={barRef}
        data-no-drag
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        className={cn("group relative flex h-3 flex-1 items-center", seekable && "cursor-pointer")}
      >
        <span className="relative h-px w-full bg-border">
          {seekable && (
            <>
              <span
                className="absolute inset-0 origin-left bg-foreground"
                style={{ transform: `scaleX(${frac})`, transition: barTransition }}
              />
              {/* Full-width carrier slid left by the unplayed fraction, so its
                  right edge (where the thumb sits) tracks the fill — moving a
                  transform, not `left`, keeps the animation off the layout path. */}
              <span
                className="absolute inset-0"
                style={{ transform: `translateX(${(frac - 1) * 100}%)`, transition: barTransition }}
              >
                <span
                  className={cn(
                    "absolute top-1/2 right-0 size-2 translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground transition-opacity",
                    drag != null ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                  )}
                />
              </span>
            </>
          )}
        </span>
      </div>
      <span className="w-8 text-right">{seekable ? fmt(duration) : ""}</span>
      {api.playbackSpeed !== 1 && !now?.isRadio && (
        <Button
          variant="outline"
          data-no-drag
          aria-label={`Playback speed ${fmtSpeed(api.playbackSpeed)} — tap to reset`}
          onClick={() => api.setPlaybackSpeed(1)}
          className="mx-tap mx-press h-auto shrink-0 rounded border-border bg-transparent px-1 py-0 font-normal text-foreground leading-none tabular-nums"
        >
          {fmtSpeed(api.playbackSpeed)}
        </Button>
      )}
    </div>
  );
};
