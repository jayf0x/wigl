import { Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/wigl/utils";
import type { RowAction } from "./standardActions";

/** The `⋯` toggle plus the inline icon shortcuts, rendered inside the row's
 * flex line. `open`/`onToggle` are owned by the caller so the fold-down
 * `<RowActionPanel>` can live as its sibling. */
export const RowActionButtons = ({
  inline,
  open,
  onToggle,
}: {
  /** the already-resolved inline actions (subset of the row's action set) */
  inline: RowAction[];
  open: boolean;
  onToggle: () => void;
}) => (
  <>
    {inline.length > 0 && (
      <div className="music-row-inline shrink-0 items-center gap-0.5">
        {inline.map((a) => (
          <Tooltip key={a.label} content={a.label}>
            <Button
              variant="ghost"
              data-no-drag
              aria-label={a.label}
              onClick={() => a.run?.()}
              className={cn(
                "mx-press mx-tap h-auto rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:opacity-100",
                open
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
              )}
            >
              {a.icon}
            </Button>
          </Tooltip>
        ))}
      </div>
    )}
    <Button
      variant="ghost"
      data-no-drag
      aria-label="More actions"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        "mx-press h-auto shrink-0 rounded p-1 text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground",
        open ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
      )}
    >
      <Ellipsis className="size-3.5" />
    </Button>
  </>
);
