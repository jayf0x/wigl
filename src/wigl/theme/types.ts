// The full set of theme-controlled CSS custom properties — one entry per
// key `applyTheme` writes to :root. `as const` + `Record` below means a
// preset object missing a key, or with an extra one, is a compile error:
// every preset must supply every value, no partial overrides. A preset that
// only wants to tweak a couple of values spreads a complete one (see
// `presets.ts`'s `DEFAULT_COLORS`) and overrides the rest.
export const THEME_COLOR_KEYS = [
  "background",
  "foreground",
  "card",
  "cardForeground",
  "popover",
  "popoverForeground",
  "primary",
  "primaryForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "accent",
  "accentForeground",
  "destructive",
  "border",
  "input",
  "ring",
  "wiglAccent",
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];

export type ThemeColors = Record<ThemeColorKey, string>;

export interface ThemePreset {
  id: string;
  name: string;
  colors: ThemeColors;
}

export const DEFAULT_THEME_ID = "default";

// Selecting this id means the active colors come from generateParametricColors
// + the persisted knobs (see useTheme), not a PRESETS lookup.
export const CUSTOM_THEME_ID = "custom";
