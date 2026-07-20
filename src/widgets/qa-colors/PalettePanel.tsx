import twColors from "./tw-colors.generated.json";

// Regenerate via `bun run tw-colors > src/widgets/qa-colors/tw-colors.generated.json`
// whenever node_modules/tailwindcss/theme.css changes (a tailwindcss bump).
interface TwColorFamily {
  name: string;
  shades: Record<string, string>;
}

const SHADE_ORDER = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950", "DEFAULT"];

/** The raw Tailwind v4 palette (every `--color-*` in tailwindcss/theme.css)
 * for reference only — these are inert oklch literals, not theme tokens;
 * nothing here reacts to useTheme. Useful when picking which shade a
 * parametric formula should land on, not for QA-ing the live theme itself
 * (see SemanticSwatches for that). */
export const PalettePanel = () => (
  <div className="flex flex-col gap-3">
    {(twColors as unknown as TwColorFamily[]).map((family) => (
      <div key={family.name} className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[10px] opacity-70">{family.name}</span>
        <div className="flex flex-1 gap-1">
          {SHADE_ORDER.filter((shade) => shade in family.shades).map((shade) => (
            <div
              key={shade}
              className="h-8 flex-1 rounded-sm border border-border/50"
              style={{ background: family.shades[shade] }}
              title={`${family.name}-${shade}: ${family.shades[shade]}`}
            />
          ))}
        </div>
      </div>
    ))}
  </div>
);
