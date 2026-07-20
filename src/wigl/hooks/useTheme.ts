import { useLayoutEffect } from "react";
import { applyTheme } from "../theme/applyTheme";
import { PRESETS } from "../theme/presets";
import { DEFAULT_THEME_ID } from "../theme/types";
import { useStorage } from "./useStorage";

/**
 * The active theme id, persisted the same way any other widget state is
 * (`useStorage`), applied to :root on load and whenever it changes. Every
 * window polls the same DB row, so picking a theme in one monitor's window
 * shows up in every other monitor's window too — no extra sync needed.
 *
 * A layout effect, not a plain one: App.css defines no color values at all
 * (see its top comment) — the theme is the only source, so this must run
 * before paint or the first frame renders with every color var unset.
 */
export const useTheme = () => {
  const [themeId, setThemeId] = useStorage<string>("wigl_theme", DEFAULT_THEME_ID);

  useLayoutEffect(() => {
    const preset = PRESETS.find((p) => p.id === themeId) ?? PRESETS[0];
    applyTheme(preset.colors);
  }, [themeId]);

  return [themeId, setThemeId] as const;
};
