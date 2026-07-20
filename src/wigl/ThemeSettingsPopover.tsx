import { Popover, PopoverContent, PopoverHeader, PopoverTitle } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import type { ParametricKnobs } from "./theme/parametric";
import { PRESETS } from "./theme/presets";
import { CUSTOM_THEME_ID } from "./theme/types";
import { cn } from "./utils";

interface ThemeSettingsPopoverProps {
  // Screen point the "Settings" menu entry was clicked at — wigl has no
  // persistent chrome to anchor a real trigger element to, so the popover
  // is positioned against a virtual one instead (base-ui Positioner accepts
  // any getBoundingClientRect()-shaped anchor, not just a DOM element).
  anchor: { x: number; y: number } | null;
  themeId: string;
  onSelect: (id: string) => void;
  knobs: ParametricKnobs;
  onKnobsChange: (knobs: ParametricKnobs) => void;
  onClose: () => void;
}

// Deliberately unlabeled beyond a letter — these aren't "background" or
// "primary" pickers, they're formula inputs; every token below rides along
// with whichever knob moves (see parametric.ts).
const KNOB_FIELDS: Array<{ key: "a" | "b" | "c"; label: string }> = [
  { key: "a", label: "A" },
  { key: "b", label: "B" },
  { key: "c", label: "C" },
];

// Elevation sliders: how far card/popover, secondary/muted, and accent step
// from `background` toward `foreground` — negative steps away instead (see
// parametric.ts). This is what makes e.g. Dracula's darker-than-background
// card reachable, not just Nord/Gruvbox's lighter one.
const ELEVATION_FIELDS: Array<{ key: "cardElevation" | "surfaceElevation" | "accentElevation"; label: string }> = [
  { key: "cardElevation", label: "Card" },
  { key: "surfaceElevation", label: "Surface" },
  { key: "accentElevation", label: "Accent" },
];

/** The global settings panel — a preset picker plus a "Custom" entry whose
 * 3 color knobs drive generateParametricColors (see theme/parametric.ts).
 * Selecting a preset or dragging a knob applies and saves immediately via
 * useTheme's own useStorage writes. */
export const ThemeSettingsPopover = ({
  anchor,
  themeId,
  onSelect,
  knobs,
  onKnobsChange,
  onClose,
}: ThemeSettingsPopoverProps) => {
  if (!anchor) return null;
  const rect = new DOMRect(anchor.x, anchor.y, 0, 0);

  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverContent anchor={{ getBoundingClientRect: () => rect }} side="right" align="start" data-no-drag>
        <PopoverHeader>
          <PopoverTitle>Theme</PopoverTitle>
        </PopoverHeader>
        <div className="flex flex-col gap-0.5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              className={cn(
                "rounded-md px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                p.id === themeId && "bg-accent text-accent-foreground",
              )}
            >
              {p.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => onSelect(CUSTOM_THEME_ID)}
            className={cn(
              "rounded-md px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground",
              themeId === CUSTOM_THEME_ID && "bg-accent text-accent-foreground",
            )}
          >
            Custom
          </button>
        </div>
        {themeId === CUSTOM_THEME_ID && (
          <div className="mt-2 flex flex-col gap-2 border-t pt-2">
            <div className="flex items-center justify-center gap-2">
              {KNOB_FIELDS.map(({ key, label }) => (
                <input
                  key={key}
                  type="color"
                  title={label}
                  aria-label={label}
                  value={knobs[key]}
                  onChange={(e) => onKnobsChange({ ...knobs, [key]: e.target.value })}
                  className="h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent p-0"
                />
              ))}
            </div>
            <div className="flex flex-col gap-1.5 px-1">
              {ELEVATION_FIELDS.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-14 shrink-0 text-muted-foreground text-xs">{label}</span>
                  <Slider
                    min={-0.3}
                    max={0.4}
                    step={0.01}
                    value={knobs[key]}
                    onValueChange={(v) => onKnobsChange({ ...knobs, [key]: Array.isArray(v) ? v[0] : v })}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
