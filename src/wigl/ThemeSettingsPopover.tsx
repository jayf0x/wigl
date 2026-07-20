import { type CSSProperties, useLayoutEffect } from "react";
import { Popover, PopoverContent, PopoverHeader, PopoverTitle } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { useStorage } from "./hooks/useStorage";
import { applyTheme } from "./theme/applyTheme";
import { DEFAULT_KNOBS, generateParametricColors, type ParametricKnobs } from "./theme/parametric";
import { PRESETS } from "./theme/presets";
import { CUSTOM_THEME_ID, DEFAULT_THEME_ID } from "./theme/types";
import { cn } from "./utils";

interface ThemeSettingsPopoverProps {
  // Screen point the "Settings" menu entry was clicked at — wigl has no
  // persistent chrome to anchor a real trigger element to, so the popover
  // is positioned against a virtual one instead (base-ui Positioner accepts
  // any getBoundingClientRect()-shaped anchor, not just a DOM element).
  anchor: { x: number; y: number } | null;
  onClose: () => void;
}

// Hue dials: which color family each role reads as. Unlike the old A/B/C
// color pickers these map to an actual role — "Primary" only ever changes
// primary/ring/wiglAccent's hue, "Background" only the surface family —
// because parametric.ts's formulas keep everything else (lightness,
// chroma, which tokens move together) fixed. Moving one dial should feel
// like restyling the whole app, not editing a CSS var.
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
 * hue isn't. The slider itself is rendered with a transparent track/
 * indicator on top of the gradient so the thumb still drags normally. */
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

/**
 * The global settings panel — a preset picker plus a "Custom" entry whose
 * 3 hue dials + 3 filter sliders drive generateParametricColors (see
 * theme/parametric.ts). Owns the persisted theme id/knobs itself (rather
 * than receiving them from Desktop.tsx) and applies them to :root via a
 * layout effect that runs on every render, including while closed — Desktop
 * renders this component unconditionally and only ever varies `anchor`, so
 * the theme keeps applying on load/change whether or not the popover UI
 * itself is open.
 */
export const ThemeSettingsPopover = ({ anchor, onClose }: ThemeSettingsPopoverProps) => {
  const [themeId, setThemeId] = useStorage<string>("wigl_theme", DEFAULT_THEME_ID);
  const [knobs, setKnobs] = useStorage<ParametricKnobs>("wigl_theme_knobs", DEFAULT_KNOBS);

  useLayoutEffect(() => {
    if (themeId === CUSTOM_THEME_ID) {
      // Spread over DEFAULT_KNOBS: knobs persisted before a knob existed
      // won't have that key, and generateParametricColors requires all of them.
      applyTheme(generateParametricColors({ ...DEFAULT_KNOBS, ...knobs }));
      return;
    }
    const preset = PRESETS.find((p) => p.id === themeId) ?? PRESETS[0];
    applyTheme(preset.colors);
  }, [themeId, knobs]);

  if (!anchor) return null;
  const rect = new DOMRect(anchor.x, anchor.y, 0, 0);
  const mergedKnobs = { ...DEFAULT_KNOBS, ...knobs };
  const customPreview = generateParametricColors(mergedKnobs).primary;

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverContent
        anchor={{ getBoundingClientRect: () => rect }}
        side="right"
        align="start"
        className="w-80"
        data-no-drag
      >
        <PopoverHeader>
          <PopoverTitle>Theme</PopoverTitle>
        </PopoverHeader>
        <div className="flex flex-col gap-0.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setThemeId(p.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                p.id === themeId && "bg-accent text-accent-foreground",
              )}
            >
              <span
                className="size-2.5 shrink-0 rounded-full ring-1 ring-foreground/15"
                style={swatchStyle(p.colors.primary)}
              />
              {p.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setThemeId(CUSTOM_THEME_ID)}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground",
              themeId === CUSTOM_THEME_ID && "bg-accent text-accent-foreground",
            )}
          >
            <span
              className="size-2.5 shrink-0 rounded-full ring-1 ring-foreground/15"
              style={swatchStyle(customPreview)}
            />
            Custom
          </button>
        </div>
        {themeId === CUSTOM_THEME_ID && (
          <div className="flex flex-col gap-3 border-t pt-2.5">
            <div className="flex flex-col gap-1.5">
              <span className="px-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">Hue</span>
              {HUE_FIELDS.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2 px-1">
                  <span className="w-16 shrink-0 text-xs">{label}</span>
                  <HueSlider value={mergedKnobs[key]} onChange={(v) => setKnobs({ ...mergedKnobs, [key]: v })} />
                  <span className="w-9 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                    {Math.round(mergedKnobs[key])}°
                  </span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="px-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">Adjust</span>
              {FILTER_FIELDS.map(({ key, label, min, max }) => (
                <div key={key} className="flex items-center gap-2 px-1">
                  <span className="w-16 shrink-0 text-xs">{label}</span>
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
      </PopoverContent>
    </Popover>
  );
};
