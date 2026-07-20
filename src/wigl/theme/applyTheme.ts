import type { ThemeColors } from "./types";

const COLOR_VAR: Record<keyof ThemeColors, string> = {
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
  chart1: "--chart-1",
  chart2: "--chart-2",
  chart3: "--chart-3",
  chart4: "--chart-4",
  chart5: "--chart-5",
  radius: "--radius",
  sidebar: "--sidebar",
  sidebarForeground: "--sidebar-foreground",
  sidebarPrimary: "--sidebar-primary",
  sidebarPrimaryForeground: "--sidebar-primary-foreground",
  sidebarAccent: "--sidebar-accent",
  sidebarAccentForeground: "--sidebar-accent-foreground",
  sidebarBorder: "--sidebar-border",
  sidebarRing: "--sidebar-ring",
  wiglAccent: "--wigl-accent",
};

const ALL_VARS: readonly string[] = Object.values(COLOR_VAR);

// App.css's own --wigl-accent default — the fallback once a theme's
// `wiglAccent` is cleared, and canvas drawing's own fallback (see getWiglAccent).
const DEFAULT_ACCENT = "#6ee7c7";

// Canvas 2D can't read a CSS var per frame without a getComputedStyle call,
// so applyTheme mirrors --wigl-accent into a plain module var alongside
// setting it on :root — see Desktop.tsx's field-drawing loop.
let currentAccent = DEFAULT_ACCENT;

/** The live --wigl-accent value, for JS drawing code that can't use a CSS var directly. */
export const getWiglAccent = (): string => currentAccent;

/**
 * Applies a theme's colors onto :root — a loop of `setProperty` over the
 * vars above. Vars the theme doesn't set are cleared first, so they fall
 * back to App.css's own defaults rather than a stale previous theme's value.
 */
export const applyTheme = (colors: ThemeColors): void => {
  const root = document.documentElement;
  for (const v of ALL_VARS) root.style.removeProperty(v);
  for (const k of Object.keys(colors) as (keyof ThemeColors)[]) {
    const v = colors[k];
    if (v) root.style.setProperty(COLOR_VAR[k], v);
  }
  currentAccent = colors.wiglAccent ?? DEFAULT_ACCENT;
};
