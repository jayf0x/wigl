import { formatCss, formatHex, oklch, parse } from "culori";
import type { ThemeColors } from "./types";

// A parametric theme has exactly 3 root knobs — everything else in
// ThemeColors is derived from these, matching every other preset's flat
// shape (see presets.ts) so it can drop straight into applyTheme unchanged.
// Knobs are deliberately unnamed by role (not "primary"/"background") —
// dragging one is "change knob A", not "edit --background"; every other
// token rides along because it's a formula over the 3 knobs, never a direct
// var edit. See the design conversation this came out of.
export interface ParametricKnobs {
  a: string;
  b: string;
  c: string;
  // Elevation steps (see `elevate` below) exposed as their own knobs instead
  // of baked-in constants — presets like Dracula/Catppuccin put `card`
  // *below* `background` (negative step) while Nord/Gruvbox put it above
  // (positive), so a single hardcoded sign can't fit both. Range roughly
  // -0.3..0.4; sign is direction (toward vs. away from `foreground`),
  // magnitude is how far.
  cardElevation: number;
  surfaceElevation: number;
  accentElevation: number;
}

export const DEFAULT_KNOBS: ParametricKnobs = {
  a: "#28282c",
  b: "#6ee7c7",
  c: "#bd93f9",
  cardElevation: 0.12,
  surfaceElevation: 0.22,
  accentElevation: 0.22,
};

interface Ok {
  l: number;
  c: number;
  h: number;
}

const toOk = (color: string): Ok => {
  const c = oklch(parse(color) ?? "#888888");
  return { l: c?.l ?? 0.5, c: c?.c ?? 0, h: c?.h ?? 0 };
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// Weighted mix in OKLCH — l/c average linearly, hue averages circularly
// (via unit vectors) so e.g. 350deg and 10deg blend to 0deg, not 180deg.
// This is the "primary = knobB + knobA*0.3 + knobC*0.1" formula from the
// design conversation, evaluated in a perceptual color space instead of
// raw component math.
const mix = (entries: Array<[Ok, number]>): Ok => {
  const total = entries.reduce((s, [, w]) => s + w, 0) || 1;
  let l = 0;
  let c = 0;
  let hx = 0;
  let hy = 0;
  for (const [ok, w] of entries) {
    const weight = w / total;
    l += ok.l * weight;
    c += ok.c * weight;
    const rad = (ok.h * Math.PI) / 180;
    hx += Math.cos(rad) * weight;
    hy += Math.sin(rad) * weight;
  }
  const h = (Math.atan2(hy, hx) * 180) / Math.PI;
  return { l, c, h: (h + 360) % 360 };
};

const withL = (ok: Ok, l: number): Ok => ({ ...ok, l: clamp(l, 0, 1) });
const withC = (ok: Ok, factor: number): Ok => ({ ...ok, c: clamp(ok.c * factor, 0, 0.4) });
const css = (ok: Ok): string => formatCss({ mode: "oklch", l: ok.l, c: ok.c, h: ok.h });
const hex = (ok: Ok): string => formatHex({ mode: "oklch", l: ok.l, c: ok.c, h: ok.h });

/**
 * Derives a full ThemeColors set from 3 root colors. Unlike the hand-written
 * presets (always dark, see presets.ts), knob A's lightness is read as-is —
 * dragging it toward white doesn't just lighten one var, every token that's
 * a formula over "background" (foreground, card, popover, muted-foreground,
 * border/input alpha) flips direction with it, so halfway through the drag
 * you're already halfway to a coherent light theme, not a broken dark one
 * with one pale rectangle.
 */
export const generateParametricColors = (knobs: ParametricKnobs): ThemeColors => {
  const a = toOk(knobs.a); // background/surface tone
  const b = toOk(knobs.b); // brand/primary
  const c = toOk(knobs.c); // accent

  const background = a;
  const isDarkBg = background.l < 0.5;

  // foreground: the contrast partner of background — near-white on a dark
  // background, near-black on a light one — tinted faintly with a's hue so
  // it never reads as flat, library-default gray.
  const foreground = withC({ l: isDarkBg ? 0.97 : 0.16, c: a.c, h: a.h }, 0.25);

  // Elevation: surfaces step a tunable fraction of the way from background
  // toward foreground — steps can go negative to step *away* from
  // foreground instead (see ParametricKnobs). Dragging `a` toward white
  // still flips the overall light/dark direction automatically, since the
  // step is relative to (foreground - background), not an absolute sign.
  const elevate = (steps: number): Ok => withL(background, background.l + (foreground.l - background.l) * steps);
  const card = elevate(knobs.cardElevation);
  const popover = card;
  const secondary = elevate(knobs.surfaceElevation);
  const muted = secondary;

  // mutedForeground: partway between foreground and background — readable
  // but visibly de-emphasized against either.
  const mutedForeground = withC({ ...foreground, l: foreground.l + (background.l - foreground.l) * 0.35 }, 1);

  // primary = mostly brand, some background tone, a touch of accent — the
  // weighted-mix formula from the conversation. Lightness then gets pulled
  // toward whichever end contrasts with the background, so it stays a
  // legible button color whether background is light or dark.
  const primaryMix = mix([
    [b, 1],
    [a, 0.3],
    [c, 0.1],
  ]);
  const contrastTarget = isDarkBg ? 0.78 : 0.4;
  const primary = withC(withL(primaryMix, primaryMix.l * 0.5 + contrastTarget * 0.5), 1.15);
  // primaryForeground: reuse background/foreground themselves rather than a
  // flat achromatic gray — every hand-written preset does this (a light
  // primary button gets the theme's actual dark background as its text
  // color, not a generic near-black), and it keeps the button tinted with
  // the theme's hue instead of reading as a library-default gray-on-color.
  const primaryForeground = primary.l > 0.55 ? background : foreground;

  const accentToken = withL(
    mix([
      [c, 1],
      [a, 0.4],
    ]),
    background.l + (foreground.l - background.l) * knobs.accentElevation,
  );

  // Border/input ride on foreground's alpha, not a fixed color — since
  // foreground already flips light/dark with background, so does the
  // overlay direction, with no extra branching needed.
  const borderAlpha = { mode: "oklch" as const, l: foreground.l, c: 0, h: 0, alpha: 0.1 };
  const inputAlpha = { mode: "oklch" as const, l: foreground.l, c: 0, h: 0, alpha: 0.15 };

  return {
    background: css(background),
    foreground: css(foreground),
    card: css(card),
    cardForeground: css(foreground),
    popover: css(popover),
    popoverForeground: css(foreground),
    primary: css(primary),
    primaryForeground: css(primaryForeground),
    secondary: css(secondary),
    secondaryForeground: css(foreground),
    muted: css(muted),
    mutedForeground: css(mutedForeground),
    accent: css(accentToken),
    accentForeground: css(foreground),
    // Destructive stays a fixed semantic red, not derived from the knobs —
    // "danger" shouldn't change meaning because the user picked a red brand.
    destructive: "oklch(0.704 0.191 22.216)",
    border: formatCss(borderAlpha),
    input: formatCss(inputAlpha),
    ring: css(primary),
    wiglAccent: hex(primary),
  };
};
