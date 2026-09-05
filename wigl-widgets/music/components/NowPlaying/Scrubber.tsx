import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/wigl/utils";
import type { MusicApi } from "../../useMusic";
import { fmt, fmtSpeed } from "./format";

/** Click / drag the timeline to seek. Frozen to the drag position while the
 * pointer is down; snaps back to the live `elapsed` on release + reconcile. */
export const Scrubber = ({ api }: { api: MusicApi }) => {
  const { now } = api;
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null); // fraction 0..1 while dragging
  const duration = now?.duration ?? 0;

  // Smooth clock (A2): an artificial rAF counter that advances `displayPos` by
  // real elapsed time (× playback speed) every frame, so the label/scrubber
  // tick continuously instead of stepping on MA's sparse `queue_time_updated`
  // (~1 event / several seconds). Whenever `api.getProgress()` delivers a
  // fresh server position we reconcile: a big delta snaps + fires an LED
  // blink (`.mx-sync`) on the time label — the "synth" flourish; a small one
  // (<0.35s drift) glides in silently. Radio ("live") skips all of this.
  const [live, setLive] = useState<number | null>(null);
  const [syncKey, setSyncKey] = useState(0);
  const posRef = useRef(0);
  const playing = !!now?.playing && !now?.isRadio;
  const trackKey = now?.title ?? "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the counter on track change
  useEffect(() => {
    posRef.current = now?.elapsed ?? 0;
    setLive(posRef.current);
  }, [trackKey]);
  useEffect(() => {
    if (!playing) {
      setLive(null);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const frame = (t: number) => {
      const dt = Math.max(0, (t - last) / 1000);
      last = t;
      // `api.getProgress()` projects the playhead forward from the seek target
      // (hook-side) until the SDK clock catches up, so this never snaps
      // backward on a scrub even through a long rebuffer (P0.3).
      const p = api.getProgress();
      const rate = p?.playbackSpeed && p.playbackSpeed > 0 ? p.playbackSpeed : 1;
      posRef.current += dt * rate;
      if (p && p.position > 0) {
        const diff = p.position - posRef.current;
        if (Math.abs(diff) > 0.35) {
          posRef.current = p.position;
          setSyncKey((k) => k + 1); // replay .mx-sync
        } else if (Math.abs(diff) > 0.02) {
          posRef.current += diff * 0.12; // glide
        }
      }
      setLive(posRef.current);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, api]);
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
  };

  const livePct = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;
  const pct = drag != null ? drag * 100 : livePct;
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
              <span className="absolute inset-y-0 left-0 bg-foreground" style={{ width: `${pct}%` }} />
              <span
                className={cn(
                  "absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground transition-opacity",
                  drag != null ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                style={{ left: `${pct}%` }}
              />
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
