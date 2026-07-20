import { Popover, PopoverContent, PopoverHeader, PopoverTitle } from "@/components/ui/popover";
import { PRESETS } from "./theme/presets";
import { cn } from "./utils";

interface ThemeSettingsPopoverProps {
  // Screen point the "Settings" menu entry was clicked at — wigl has no
  // persistent chrome to anchor a real trigger element to, so the popover
  // is positioned against a virtual one instead (base-ui Positioner accepts
  // any getBoundingClientRect()-shaped anchor, not just a DOM element).
  anchor: { x: number; y: number } | null;
  themeId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** The global settings panel — for now just a theme picker; selecting one
 * applies and saves immediately via useTheme's own useStorage write. */
export const ThemeSettingsPopover = ({ anchor, themeId, onSelect, onClose }: ThemeSettingsPopoverProps) => {
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
        </div>
      </PopoverContent>
    </Popover>
  );
};
