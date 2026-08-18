import { useLayoutEffect } from "react";
import { useStorage } from "../hooks/useStorage";
import { applyTheme } from "./applyTheme";
import { DEFAULT_KNOBS, generateParametricColors, type ParametricKnobs } from "./parametric";
import { PRESETS } from "./presets";
import { CUSTOM_THEME_ID, DEFAULT_THEME_ID } from "./types";

/**
 * Applies the persisted theme to :root on every change — split out from the
 * (now modal, not popover) Appearance section so it keeps running whether or
 * not Settings is open. Desktop.tsx mounts this unconditionally, same as
 * ThemeSettingsPopover used to.
 */
export const ThemeEffect = () => {
  const [themeId] = useStorage<string>("wigl_theme", DEFAULT_THEME_ID);
  const [knobs] = useStorage<ParametricKnobs>("wigl_theme_knobs", DEFAULT_KNOBS);

  useLayoutEffect(() => {
    if (themeId === CUSTOM_THEME_ID) {
      // Spread over DEFAULT_KNOBS: knobs persisted before a knob existed
      // won't have that key, and generateParametricColors requires all of them.
      applyTheme(generateParametricColors({ ...DEFAULT_KNOBS, ...knobs }));
      return;
    }
    const preset = PRESETS.find((p) => p.id === themeId) ?? PRESETS[0];
    applyTheme(preset.colors);
  }, [themeId, knobs]);

  return null;
};
