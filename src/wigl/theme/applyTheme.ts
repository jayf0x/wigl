import { THEME_COLOR_KEYS, type ThemeColorKey, type ThemeColors } from "./types";

const COLOR_VAR: Record<ThemeColorKey, string> = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  destructive: "--destructive",
  border: "--border",
  input: "--input",
  ring: "--ring",
  wiglAccent: "--wigl-accent",
};

/**
 * Applies a theme's colors onto :root — a loop of `setProperty` over every
 * key in `ThemeColors`. Every preset supplies every key (see types.ts), so
 * this is a full overwrite each time, never a partial patch over whatever
 * the previous theme left behind.
 */
export const applyTheme = (colors: ThemeColors): void => {
  const root = document.documentElement;
  for (const k of THEME_COLOR_KEYS) root.style.setProperty(COLOR_VAR[k], colors[k]);
};
