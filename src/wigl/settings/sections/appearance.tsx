import type { CSSProperties } from "react";
import { Slider } from "@/components/ui/slider";
import { useStorage } from "../../hooks/useStorage";
import { DEFAULT_KNOBS, generateParametricColors, type ParametricKnobs } from "../../theme/parametric";
import { PRESETS } from "../../theme/presets";
import { CUSTOM_THEME_ID, DEFAULT_THEME_ID } from "../../theme/types";
import { cn } from "../../utils";
import type { SettingSection } from "../types";

// Hue dials: which color family each role reads as. Unlike raw color pickers
// these map to an actual role — "Primary" only ever changes primary/ring/
// wiglAccent's hue, "Background" only the surface family — because
// parametric.ts's formulas keep everything else (lightness, chroma, which
// tokens move together) fixed.
const HUE_FIELDS: Array<{ key: "hueBackground" | "huePrimary" | "hueAccent"; label: string }> = [
  { key: "hueBackground", label: "Background" },
  { key: "huePrimary", label: "Primary" },
  { key: "hueAccent", label: "Accent" },
];

// Global filters, the photo-editing-panel half of the mental model: each
// one nudges a formula shared by every token at once, never a single var.
const FILTER_FIELDS: Array<{
  key: "brightness" | "contrast" | "saturation";
  label: string;
  min: number;
  max: number;
}> = [
  { key: "brightness", label: "Brightness", min: 0, max: 1 },
  { key: "contrast", label: "Contrast", min: 0.5, max: 1.5 },
  { key: "saturation", label: "Saturation", min: 0, max: 1 },
];

const swatchStyle = (color: string): CSSProperties => ({ background: color });

/** A hue dial: a 0-360 slider drawn over its own rainbow track instead of
 * the default fill-from-zero indicator — a fill reads as "amount", which
 * hue isn't. */
const HueSlider = ({ value, onChange }: { value: number; onChange: (v: number) => void }) => (
  <div className="relative flex h-5 w-full items-center">
    <div
      className="pointer-events-none absolute inset-x-0.5 h-1 rounded-full"
      style={{
        background:
          "linear-gradient(to right, oklch(0.75 0.15 0), oklch(0.75 0.15 60), oklch(0.75 0.15 120), oklch(0.75 0.15 180), oklch(0.75 0.15 240), oklch(0.75 0.15 300), oklch(0.75 0.15 360))",
      }}
    />
    <Slider
      min={0}
      max={360}
      step={1}
      value={value}
      onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      className="relative [&_[data-slot=slider-indicator]]:bg-transparent [&_[data-slot=slider-track]]:before:bg-transparent"
    />
  </div>
);

/** A preset swatch: 4 stacked color chips + name, laid out as a grid card
 * instead of the old popover's single list row — the modal has the width to
 * show more of the palette at a glance. */
const PresetCard = ({
  name,
  colors,
  active,
  onClick,
}: {
  name: string;
  colors: readonly string[];
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "flex flex-col gap-2 rounded-lg border border-border/60 p-2.5 text-left transition-colors hover:border-border hover:bg-accent/40",
      active && "border-primary/70 bg-accent/60 ring-1 ring-primary/40",
    )}
  >
    <div className="flex h-6 overflow-hidden rounded-md ring-1 ring-foreground/10">
      {colors.map((c, i) => (
        <span key={`${c}-${i}`} className="flex-1" style={swatchStyle(c)} />
      ))}
    </div>
    <span className="px-0.5 font-mono text-[11px] tracking-wide">{name}</span>
  </button>
);

const AppearanceSection = () => {
  const [themeId, setThemeId] = useStorage<string>("wigl_theme", DEFAULT_THEME_ID);
  const [knobs, setKnobs] = useStorage<ParametricKnobs>("wigl_theme_knobs", DEFAULT_KNOBS);
  const mergedKnobs = { ...DEFAULT_KNOBS, ...knobs };
  const customPreview = generateParametricColors(mergedKnobs);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 px-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-widest">
          Theme
        </div>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((p) => (
            <PresetCard
              key={p.id}
              name={p.name}
              active={p.id === themeId}
              onClick={() => setThemeId(p.id)}
              colors={[p.colors.background, p.colors.card, p.colors.primary, p.colors.wiglAccent]}
            />
          ))}
          <PresetCard
            name="Custom"
            active={themeId === CUSTOM_THEME_ID}
            onClick={() => setThemeId(CUSTOM_THEME_ID)}
            colors={[
              customPreview.background,
              customPreview.card,
              customPreview.primary,
              customPreview.wiglAccent,
            ]}
          />
        </div>
      </div>

      {themeId === CUSTOM_THEME_ID && (
        <div className="flex flex-col gap-3 border-border/60 border-t pt-3">
          <div className="flex flex-col gap-1.5">
            <span className="px-1 font-medium text-[10px] text-muted-foreground uppercase tracking-widest">Hue</span>
            {HUE_FIELDS.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-2 px-1">
                <span className="w-20 shrink-0 text-xs">{label}</span>
                <HueSlider value={mergedKnobs[key]} onChange={(v) => setKnobs({ ...mergedKnobs, [key]: v })} />
                <span className="w-9 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                  {Math.round(mergedKnobs[key])}°
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="px-1 font-medium text-[10px] text-muted-foreground uppercase tracking-widest">
              Adjust
            </span>
            {FILTER_FIELDS.map(({ key, label, min, max }) => (
              <div key={key} className="flex items-center gap-2 px-1">
                <span className="w-20 shrink-0 text-xs">{label}</span>
                <Slider
                  min={min}
                  max={max}
                  step={0.01}
                  value={mergedKnobs[key]}
                  onValueChange={(v) => setKnobs({ ...mergedKnobs, [key]: Array.isArray(v) ? v[0] : v })}
                />
                <span className="w-9 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                  {Math.round(mergedKnobs[key] * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const appearanceSection: SettingSection = {
  id: "appearance",
  label: "Appearance",
  fields: [
    { id: "theme-preset", label: "Theme preset", keywords: ["color", "dark", "light", "nord", "dracula", "catppuccin", "gruvbox"] },
    { id: "theme-custom", label: "Custom theme", keywords: ["hue", "brightness", "contrast", "saturation", "parametric"] },
  ],
  render: () => <AppearanceSection />,
};
