// Extracts every `--color-*` custom property Tailwind v4 ships in its own
// theme.css (the only place the full palette + OKLCH values live — there's
// no API for this) and prints it as JSON: { family: { shade: cssValue } }.
// Used by the qa-colors widget's build step isn't needed — the widget
// imports this data as a plain generated JSON file (see `bun run tw-colors`).
import { readFileSync } from "node:fs";

const SOURCE = "node_modules/tailwindcss/theme.css";
const VAR_RE = /^\s*--color-([a-z]+)(?:-(\d+))?:\s*([^;]+);/;

export interface TwColorFamily {
  name: string;
  // "DEFAULT" for shade-less entries like --color-black/--color-white
  shades: Record<string, string>;
}

export const extractTwColors = (source = SOURCE): TwColorFamily[] => {
  const families = new Map<string, Record<string, string>>();

  for (const line of readFileSync(source, "utf-8").split("\n")) {
    const m = VAR_RE.exec(line);
    if (!m) continue;
    const [, name, shade, value] = m;
    if (!families.has(name)) families.set(name, {});
    families.get(name)![shade ?? "DEFAULT"] = value.trim();
  }

  return [...families.entries()].map(([name, shades]) => ({ name, shades }));
};

if (import.meta.main) {
  console.log(JSON.stringify(extractTwColors(), null, 2));
}
