import { Popover, PopoverContent, PopoverHeader, PopoverTitle } from "@/components/ui/popover";
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
const KNOB_FIELDS: Array<{ key: keyof ParametricKnobs; label: string }> = [
  { key: "a", label: "A" },
  { key: "b", label: "B" },
  { key: "c", label: "C" },
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
          <div className="mt-2 flex items-center justify-center gap-2 border-t pt-2">
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
        )}
      </PopoverContent>
    </Popover>
  );
};
