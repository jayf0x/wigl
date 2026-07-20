// A theme is a flat map of CSS custom property values — matches the tokens
// App.css defines under `@theme` (background, primary, popover, ...) plus
// wigl's own --wigl-accent. Applying one is just writing these onto :root;
// a key left out falls back to whatever App.css's own defaults already are.
export type ThemeColors = Partial<{
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  border: string;
  input: string;
  ring: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  radius: string;
  sidebar: string;
  sidebarForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
  wiglAccent: string;
}>;

export interface ThemePreset {
  id: string;
  name: string;
  colors: ThemeColors;
}

export const DEFAULT_THEME_ID = "default";
