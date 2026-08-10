import type { ITheme } from "@xterm/xterm";

// Reads wigl's live theme CSS vars (src/wigl/theme/applyTheme.ts writes them
// onto :root) rather than hardcoding colors — so switching the app theme
// updates the terminal too, once index.tsx's MutationObserver calls this
// again on a :root style change.
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const readTermTheme = (): ITheme => ({
  background: cssVar("--background"),
  foreground: cssVar("--foreground"),
  cursor: cssVar("--wigl-accent"),
  cursorAccent: cssVar("--background"),
  selectionBackground: cssVar("--accent"),
});
