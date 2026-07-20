// The swatches this widget draws, grouped for the grid. Two families:
//
// - `theme` tokens: driven by src/wigl/theme/ (applyTheme sets these on
//   :root, see THEME_COLOR_KEYS there) — every one of these should visibly
//   change when the active theme or the custom-theme knobs change.
// - `static` tokens: the info/success/warning/destructive-foreground set
//   `bunx shadcn add` wrote into App.css's `:root`/`.dark` blocks when the
//   badge/checkbox components were installed for this widget. They are
//   fixed Tailwind palette references (see App.css), NOT wired into
//   src/wigl/theme/ — they will NOT change with the active theme. Flagged
//   here so it's visually obvious in the widget, and called out in
//   .idea/tailwind-colors.md for the theming work to pick up or ignore.
export interface TokenSwatch {
  cssVar: string;
  label: string;
  kind: "theme" | "static";
}

export interface TokenGroup {
  name: string;
  swatches: TokenSwatch[];
}

export const TOKEN_GROUPS: TokenGroup[] = [
  {
    name: "Surfaces",
    swatches: [
      { cssVar: "--background", label: "background", kind: "theme" },
      { cssVar: "--foreground", label: "foreground", kind: "theme" },
      { cssVar: "--card", label: "card", kind: "theme" },
      { cssVar: "--card-foreground", label: "cardForeground", kind: "theme" },
      { cssVar: "--popover", label: "popover", kind: "theme" },
      { cssVar: "--popover-foreground", label: "popoverForeground", kind: "theme" },
    ],
  },
  {
    name: "Actions",
    swatches: [
      { cssVar: "--primary", label: "primary", kind: "theme" },
      { cssVar: "--primary-foreground", label: "primaryForeground", kind: "theme" },
      { cssVar: "--secondary", label: "secondary", kind: "theme" },
      { cssVar: "--secondary-foreground", label: "secondaryForeground", kind: "theme" },
      { cssVar: "--accent", label: "accent", kind: "theme" },
      { cssVar: "--accent-foreground", label: "accentForeground", kind: "theme" },
      { cssVar: "--destructive", label: "destructive", kind: "theme" },
    ],
  },
  {
    name: "Muted & chrome",
    swatches: [
      { cssVar: "--muted", label: "muted", kind: "theme" },
      { cssVar: "--muted-foreground", label: "mutedForeground", kind: "theme" },
      { cssVar: "--border", label: "border", kind: "theme" },
      { cssVar: "--input", label: "input", kind: "theme" },
      { cssVar: "--ring", label: "ring", kind: "theme" },
    ],
  },
  {
    name: "Brand",
    swatches: [{ cssVar: "--wigl-accent", label: "wiglAccent", kind: "theme" }],
  },
  {
    name: "Status (static — see note)",
    swatches: [
      { cssVar: "--destructive-foreground", label: "destructiveForeground", kind: "static" },
      { cssVar: "--info", label: "info", kind: "static" },
      { cssVar: "--info-foreground", label: "infoForeground", kind: "static" },
      { cssVar: "--success", label: "success", kind: "static" },
      { cssVar: "--success-foreground", label: "successForeground", kind: "static" },
      { cssVar: "--warning", label: "warning", kind: "static" },
      { cssVar: "--warning-foreground", label: "warningForeground", kind: "static" },
    ],
  },
];
