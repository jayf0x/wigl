import { useEffect, useRef, useState } from "react";
import { Power, RotateCcw } from "lucide-react";
import { cn } from "@/wigl/utils";
import {
  BAND_HZ,
  DEFAULT_FX,
  EQ_MAX_DB,
  EQ_MIN_DB,
  type FxState,
  fxIsFlat,
} from "../audioGraph";
import type { MusicApi } from "../useMusic";
import { VFader } from "./VFader";

/** G — the audio-effects tab: a 4-band graphic EQ + reverb, live on the
 * Sendspin output. Opening the tab transparently switches to "media-element"
 * output (the only mode with an <audio> to tap) — no separate enable step;
 * `useMusic` re-asserts the play/pause state across the reconnect.
 *
 * Slider mechanics (the "reverb slides back" fix): a local `draft` holds the
 * instant visual, `api.applyFx` pushes to the Web Audio graph on the next
 * frame (ramped there with setTargetAtTime — no zipper), and `api.setFx` (the
 * `useStorage` persist) is debounced 400ms past the last move. The faders read
 * `draft` mid-drag and stored `api.fx` otherwise, so nothing jumps back. */

const hz = (n: number) => (n >= 1000 ? `${n / 1000}k` : String(n));
const dbLabel = (v: number) => `${v > 0 ? "+" : ""}${v}`;
const EQ_MARKS = [EQ_MIN_DB, -6, 0, 6, EQ_MAX_DB];

const Connecting = () => (
  <p className="px-4 py-10 text-center text-[11px] text-muted-foreground">
    Routing audio through the effects chain…
  </p>
);

export const EffectsTab = ({ api }: { api: MusicApi }) => {
  // Transparently switch to the tappable output path on open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intent is "once, when unavailable"
  useEffect(() => {
    if (!api.fxAvailable) api.setAudioOutput("media-element");
  }, [api.fxAvailable]);

  const [draft, setDraft] = useState<FxState | null>(null);
  const fx = draft ?? api.fx;
  const rafRef = useRef(0);
  const persistRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(persistRef.current);
    },
    [],
  );

  /** continuous move: instant local + throttled graph + debounced persist */
  const move = (next: FxState) => {
    setDraft(next);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => api.applyFx(next));
    clearTimeout(persistRef.current);
    persistRef.current = setTimeout(() => {
      api.setFx(next);
      setDraft(null);
    }, 400);
  };
  /** discrete change (toggle / reset / release): persist now */
  const commit = (next: FxState) => {
    cancelAnimationFrame(rafRef.current);
    clearTimeout(persistRef.current);
    setDraft(null);
    api.setFx(next);
  };

  const withBand = (i: number, v: number): FxState => {
    const bands = fx.bands.slice();
    bands[i] = v;
    return { ...fx, bands };
  };
  const setBand = (i: number, v: number) => move(withBand(i, v));

  if (!api.fxAvailable) return <Connecting />;

  const dimmed = fx.bypass && "opacity-40";

  return (
    <div className="flex flex-col gap-3 px-2 py-2">
      <div className="flex items-center justify-between">
        <p className="music-tag text-muted-foreground/70">Effects</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-no-drag
            disabled={fxIsFlat(fx)}
            onClick={() => commit({ ...fx, bands: [...DEFAULT_FX.bands], reverb: 0 })}
            className="mx-press flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <RotateCcw className="size-2.5" /> reset
          </button>
          <button
            type="button"
            data-no-drag
            aria-pressed={fx.bypass}
            onClick={() => commit({ ...fx, bypass: !fx.bypass })}
            className={cn(
              "mx-press flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors",
              fx.bypass
                ? "border-border text-muted-foreground hover:text-foreground"
                : "border-foreground bg-foreground text-background",
            )}
          >
            <Power className="size-2.5" /> {fx.bypass ? "off" : "on"}
          </button>
        </div>
      </div>

      {/* graphic EQ */}
      <div className={cn("flex items-stretch justify-between gap-1", dimmed)}>
        {BAND_HZ.map((freq, i) => (
          <VFader
            key={freq}
            label={hz(freq)}
            display={dbLabel(fx.bands[i] ?? 0)}
            value={fx.bands[i] ?? 0}
            min={EQ_MIN_DB}
            max={EQ_MAX_DB}
            step={1}
            detent={0}
            marks={EQ_MARKS}
            onChange={(v) => setBand(i, v)}
            onCommit={(v) => commit(withBand(i, v))}
          />
        ))}
        <span className="mx-1 w-px self-stretch bg-border" />
        <VFader
          label="Reverb"
          display={`${Math.round(fx.reverb * 100)}%`}
          value={Math.round(fx.reverb * 100)}
          min={0}
          max={100}
          step={1}
          onChange={(v) => move({ ...fx, reverb: v / 100 })}
          onCommit={(v) => commit({ ...fx, reverb: v / 100 })}
        />
      </div>

      <p className="text-[9px] leading-relaxed text-muted-foreground/60">
        4-band graphic EQ (±12 dB) + room reverb. “off” bypasses the chain but
        keeps the settings. Speed control needs a time-stretch worklet — see the
        backlog.
      </p>
    </div>
  );
};
