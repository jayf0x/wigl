import { useEffect, useRef, useState } from "react";

// Shared plumbing for every mini game: phase state, a fixed-timestep rAF loop
// that exists only while running (zero idle cost), and the chrome around the
// canvas (focus handling, pause-on-blur, overlay with start/exit buttons).

export type Phase = "idle" | "running" | "paused" | "over";

export type GameProps = { onExit: () => void };

export const usePhase = () => {
  const [phase, setPhase] = useState<Phase>("idle");
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  return { phase, setPhase, phaseRef };
};

// tick/draw are read through refs so callers don't need useCallback gymnastics;
// the effect re-mounts only when `active` or `tickMs` changes.
export const useLoop = (active: boolean, tickMs: number, tick: () => void, draw: (t: number) => void) => {
  const fns = useRef({ tick, draw });
  fns.current = { tick, draw };
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = (now: number) => {
      acc = Math.min(acc + (now - last), 250); // clamp after tab stalls
      last = now;
      while (acc >= tickMs) {
        acc -= tickMs;
        fns.current.tick();
      }
      fns.current.draw(acc / tickMs);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active, tickMs]);
};

type ChromeProps = {
  phase: Phase;
  score: number;
  overLabel?: string; // e.g. "GAME OVER" / "YOU WIN"
  hint: string;
  width: number;
  height: number;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onStart: () => void;
  onExit: () => void;
  setPhase: (p: Phase) => void;
  onKey: (e: React.KeyboardEvent) => void;
  onKeyUp?: (e: React.KeyboardEvent) => void;
};

export const GameChrome = ({
  phase,
  score,
  overLabel = "GAME OVER",
  hint,
  width,
  height,
  canvasRef,
  onStart,
  onExit,
  setPhase,
  onKey,
  onKeyUp,
}: ChromeProps) => {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phase === "running") boxRef.current?.focus();
  }, [phase]);

  const btn = "rounded border border-border bg-accent/10 px-3 py-1 text-[11px] tracking-widest hover:bg-accent/25";

  return (
    <div
      ref={boxRef}
      tabIndex={0}
      data-no-drag
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          if (phase === "running") setPhase("paused");
          else if (phase === "paused") setPhase("running");
        } else if (phase === "running") onKey(e);
      }}
      onKeyUp={onKeyUp}
      onBlur={() => phase === "running" && setPhase("paused")}
      className="relative m-2 mt-1 flex-1 overflow-hidden rounded-md bg-foreground/5 outline-none ring-ring/40 focus:ring-1"
    >
      <canvas ref={canvasRef} width={width} height={height} className="h-full w-full" />
      <span className="pointer-events-none absolute right-1.5 top-1 font-mono text-[10px] tabular-nums opacity-50">
        {score}
      </span>
      {phase !== "running" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 font-mono backdrop-blur-[2px]">
          {phase === "over" && (
            <span className="text-xs tracking-widest opacity-80">
              {overLabel} · {score}
            </span>
          )}
          {phase === "paused" && <span className="text-xs tracking-widest opacity-80">PAUSED</span>}
          <div className="flex gap-2">
            {phase === "paused" ? (
              <button data-no-drag onClick={() => setPhase("running")} className={btn}>
                RESUME
              </button>
            ) : (
              <button data-no-drag onClick={onStart} className={btn}>
                {phase === "idle" ? "START" : "AGAIN"}
              </button>
            )}
            <button data-no-drag onClick={onExit} className={`${btn} opacity-60`}>
              EXIT
            </button>
          </div>
          <span className="text-[9px] opacity-40">{hint}</span>
        </div>
      )}
    </div>
  );
};
