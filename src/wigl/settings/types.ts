import type { ReactNode } from "react";

// A settings section renders its own body (hand-built UI — see
// docs/widgets.md and the AppearanceSection precedent for hue dials, a
// toggle row, whatever fits) but also declares a flat `fields` list purely
// so the modal's search box has something to match against without having
// to parse the rendered UI. `fields` is a search index, not a second
// description of the UI — keep it short, one entry per control.
export interface SettingField {
  id: string;
  label: string;
  keywords?: string[];
}

export interface SettingSection {
  id: string;
  label: string;
  fields?: SettingField[];
  render: () => ReactNode;
}
