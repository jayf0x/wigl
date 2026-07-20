import { cn } from "@/wigl/utils";
import { TOKEN_GROUPS } from "./tokens";

/** Every semantic token the active theme (or the parametric custom knobs)
 * can drive, as raw swatches — reads each value straight off the CSS var so
 * it repaints the instant useTheme's layout effect sets a new one on :root.
 * No JS re-render is needed for the color itself; only the `kind` badge is
 * static per-token metadata. */
export const SemanticSwatches = () => (
  <div className="flex flex-col gap-4">
    {TOKEN_GROUPS.map((group) => (
      <div key={group.name}>
        <div className="mb-1.5 text-[10px] tracking-widest text-muted-foreground uppercase">{group.name}</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
          {group.swatches.map((s) => (
            <div key={s.cssVar} className="flex flex-col gap-1">
              <div
                className={cn(
                  "h-12 rounded-md border border-border",
                  s.kind === "static" && "outline-dashed outline-1 outline-offset-1 outline-warning",
                )}
                style={{ background: `var(${s.cssVar})` }}
              />
              <span className="truncate text-[10px] opacity-70" title={s.cssVar}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);
