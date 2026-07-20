import { formatCss, formatHex } from "culori";
import type { ThemeColors } from "./types";

// A parametric theme has 3 hue dials — one per role family (surface, brand,
// highlight) — plus 3 global filters (brightness/contrast/saturation), the
// same mental model as a photo-editing panel. Each role's own lightness and
// chroma come from a fixed formula below, not a raw value the user sets
// directly — dragging "Primary" changes only primary/ring/wiglAccent's hue,
// nothing else moves; dragging "Contrast" nudges *every* token's separation
// at once. Nothing here is a 1:1 CSS-var edit: nudge one dial, the whole
// app's palette reflows around it and stays legible.
export interface ParametricKnobs {
  // Degrees 0-360. Which color family each role reads as.
  hueBackground: number;
  huePrimary: number;
  hueAccent: number;
  // 0-1. Where background sits on the lightness scale — 0 darkest, 1 lightest.
  brightness: number;
  // 0.5-1.5. How far foreground/surfaces separate from background — 1 is
  // the tuned default, higher is crisper, lower is flatter/lower-contrast.
  contrast: number;
  // 0-1. How vivid primary/accent read. Background/surface tones stay
  // near-gray regardless — only the two "brand" roles scale with this.
  saturation: number;
}

export const DEFAULT_KNOBS: ParametricKnobs = {
  hueBackground: 265,
  huePrimary: 300,
  hueAccent: 170,
  brightness: 0.12,
  contrast: 1,
  saturation: 0.75,
};

interface Ok {
  l: number;
  c: number;
  h: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
const css = (ok: Ok): string => formatCss({ mode: "oklch", l: ok.l, c: ok.c, h: ok.h });
const hex = (ok: Ok): string => formatHex({ mode: "oklch", l: ok.l, c: ok.c, h: ok.h });

// Surfaces (background/card/secondary) never get more saturated than this —
// "secondary always stays nearly gray" regardless of what the hue dials or
// saturation filter are set to.
const SURFACE_CHROMA = 0.02;
const CARD_STEP = 0.1;
const SURFACE_STEP = 0.2;
const ACCENT_STEP = 0.18;
const MUTED_FOREGROUND_FRAC = 0.35;

/**
 * Derives a full ThemeColors set from the 6 knobs above. `brightness` is
 * background's own lightness — dragging it toward white flips every
 * formula below that reads off "the gap between foreground and background"
 * (card/secondary/accent's elevation, muted-foreground's blend), so halfway
 * through the drag you're already halfway to a coherent light theme, not a
 * broken dark one with one pale rectangle. See `isDarkBg`.
 */
export const generateParametricColors = (knobs: ParametricKnobs): ThemeColors => {
  const backgroundL = clamp(lerp(0.08, 0.98, knobs.brightness), 0, 1);
  const isDarkBg = backgroundL < 0.5;
  const background: Ok = { l: backgroundL, c: SURFACE_CHROMA, h: knobs.hueBackground };

  // foreground: background's contrast partner. `contrast` blends between
  // "same as background" (0, unreadably flat — the slider's honest low end)
  // and the tuned near-white/near-black target (1); values above 1 push
  // past the target for extra crispness.
  const foregroundTargetL = isDarkBg ? 0.97 : 0.16;
  const foreground: Ok = {
    l: clamp(lerp(backgroundL, foregroundTargetL, knobs.contrast), 0, 1),
    c: SURFACE_CHROMA * 0.5,
    h: knobs.hueBackground,
  };

  // Elevation: surfaces step a fraction of the way from background toward
  // foreground, scaled by `contrast` — always the same direction (a raised
  // surface reads lighter on a dark theme, darker on a light one), never a
  // per-surface sign to fight with.
  const elevate = (steps: number): Ok => ({
    ...background,
    l: clamp(background.l + (foreground.l - background.l) * steps * knobs.contrast, 0, 1),
  });
  const card = elevate(CARD_STEP);
  const popover = card;
  const secondary = elevate(SURFACE_STEP);
  const muted = secondary;

  // mutedForeground: partway between foreground and background — readable
  // but visibly de-emphasized against either.
  const mutedForeground: Ok = {
    l: clamp(foreground.l + (background.l - foreground.l) * MUTED_FOREGROUND_FRAC, 0, 1),
    c: foreground.c,
    h: foreground.h,
  };

  // Brand chroma: the one place `saturation` acts — primary and accent both
  // scale off it (accent a bit calmer), everything else ignores it entirely.
  const brandChroma = clamp(lerp(0.05, 0.22, knobs.saturation), 0, 0.4);

  const primaryTargetL = isDarkBg ? 0.78 : 0.42;
  const primary: Ok = {
    // Mostly the fixed contrast target, a slight pull toward background's
    // own lightness so it still reads as "this theme's" primary color
    // instead of a floating swatch unrelated to the rest of the palette.
    l: clamp(lerp(backgroundL, primaryTargetL, 0.85), 0, 1),
    c: brandChroma,
    h: knobs.huePrimary,
  };
  // primaryForeground: whichever of background/foreground contrasts harder
  // against primary's lightness — not "background if light, foreground if
  // dark", which silently assumes background is the dark one and inverts on
  // a light theme (background *is* the light extreme there).
  const primaryForeground =
    Math.abs(background.l - primary.l) > Math.abs(foreground.l - primary.l) ? background : foreground;

  const accent: Ok = {
    l: elevate(ACCENT_STEP).l,
    c: clamp(brandChroma * 0.4, 0, 0.4),
    h: knobs.hueAccent,
  };

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
    accent: css(accent),
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
