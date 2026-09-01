import { RotateCcw, Sparkles } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/wigl/utils";
import { DEFAULT_FX, type FxState, fxIsFlat } from "../audioGraph";
import type { MusicApi } from "../useMusic";

/** G1 — the audio-effects tab. EQ (3 band) + reverb + echo, live on the
 * Sendspin output. No speed control — a MediaStream ignores `playbackRate`
 * (see audioGraph.ts). Needs "media-element" output mode. */

type Band = { key: keyof FxState; label: string; min: number; max: number; unit: string; fmt?: (v: number) => string };

const BANDS: Band[] = [
  { key: "low", label: "Bass", min: -12, max: 12, unit: "dB", fmt: (v) => `${v > 0 ? "+" : ""}${v}` },
  { key: "mid", label: "Mid", min: -12, max: 12, unit: "dB", fmt: (v) => `${v > 0 ? "+" : ""}${v}` },
  { key: "high", label: "Treble", min: -12, max: 12, unit: "dB", fmt: (v) => `${v > 0 ? "+" : ""}${v}` },
  { key: "reverb", label: "Reverb", min: 0, max: 100, unit: "%", fmt: (v) => String(v) },
  { key: "echo", label: "Echo", min: 0, max: 100, unit: "%", fmt: (v) => String(v) },
];

// FxState stores reverb/echo as 0..1; the sliders work in 0..100.
const toSlider = (key: keyof FxState, v: number) => (key === "reverb" || key === "echo" ? Math.round(v * 100) : v);
const fromSlider = (key: keyof FxState, v: number) => (key === "reverb" || key === "echo" ? v / 100 : v);

const EnablePrompt = ({ api }: { api: MusicApi }) => (
  <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-muted-foreground">
    <Sparkles className="size-5 text-foreground/50" />
    <p className="text-[11px]">
      Audio effects need the media-element output path. Turning it on reconnects
      the player (a brief gap in playback).
    </p>
    <button
      type="button"
      data-no-drag
      onClick={() => api.setAudioOutput("media-element")}
      className="rounded-md border border-border px-3 py-1.5 text-[11px] text-foreground transition-colors hover:bg-accent"
    >
      Enable audio effects
    </button>
  </div>
);

export const EffectsTab = ({ api }: { api: MusicApi }) => {
  if (!api.fxAvailable) return <EnablePrompt api={api} />;

  const { fx, setFx } = api;
  const set = (key: keyof FxState, sliderVal: number) => setFx({ ...fx, [key]: fromSlider(key, sliderVal) });

  return (
    <div className="flex flex-col gap-3 px-2 py-2">
      <div className="flex items-center justify-between">
        <p className="music-tag text-muted-foreground/70">Effects</p>
        <button
          type="button"
          data-no-drag
          disabled={fxIsFlat(fx)}
          onClick={() => setFx(DEFAULT_FX)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          <RotateCcw className="size-2.5" /> reset
        </button>
      </div>

      {BANDS.map((b) => {
        const slider = toSlider(b.key, fx[b.key]);
        return (
          <div key={b.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between text-[10px]">
              <span className="text-foreground/80">{b.label}</span>
              <span className={cn("tabular-nums text-muted-foreground", slider !== 0 && "text-foreground/80")}>
                {(b.fmt ?? String)(slider)} {b.unit}
              </span>
            </div>
            <Slider
              className="w-full"
              value={[slider]}
              min={b.min}
              max={b.max}
              step={1}
              onValueChange={(v) => set(b.key, Array.isArray(v) ? v[0] : v)}
            />
          </div>
        );
      })}

      <button
        type="button"
        data-no-drag
        onClick={() => api.setAudioOutput("direct")}
        className="mt-1 self-start text-[10px] text-muted-foreground/60 hover:text-foreground"
      >
        turn effects off (back to direct output)
      </button>
    </div>
  );
};
