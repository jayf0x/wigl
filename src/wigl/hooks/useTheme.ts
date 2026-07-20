import { useLayoutEffect } from "react";
import { applyTheme } from "../theme/applyTheme";
import { DEFAULT_KNOBS, generateParametricColors, type ParametricKnobs } from "../theme/parametric";
import { PRESETS } from "../theme/presets";
import { CUSTOM_THEME_ID, DEFAULT_THEME_ID } from "../theme/types";
import { useStorage } from "./useStorage";

/**
 * The active theme id, persisted the same way any other widget state is
 * (`useStorage`), applied to :root on load and whenever it changes. Every
 * window polls the same DB row, so picking a theme in one monitor's window
 * shows up in every other monitor's window too — no extra sync needed.
 *
 * When themeId is CUSTOM_THEME_ID, colors come from generateParametricColors
 * over the 3 persisted knobs instead of a PRESETS lookup — see parametric.ts.
 *
 * A layout effect, not a plain one: App.css defines no color values at all
 * (see its top comment) — the theme is the only source, so this must run
 * before paint or the first frame renders with every color var unset.
 */
export const useTheme = () => {
  const [themeId, setThemeId] = useStorage<string>("wigl_theme", DEFAULT_THEME_ID);
  const [knobs, setKnobs] = useStorage<ParametricKnobs>("wigl_theme_knobs", DEFAULT_KNOBS);

  useLayoutEffect(() => {
    if (themeId === CUSTOM_THEME_ID) {
      applyTheme(generateParametricColors(knobs));
      return;
    }
    const preset = PRESETS.find((p) => p.id === themeId) ?? PRESETS[0];
    applyTheme(preset.colors);
  }, [themeId, knobs]);

  return [themeId, setThemeId, knobs, setKnobs] as const;
};
