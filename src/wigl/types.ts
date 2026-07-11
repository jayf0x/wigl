// The full widget contract. A widget is a folder: src/widgets/<name>/index.tsx
// default-exporting a component, optionally exporting `windowConfig`.
// App.tsx discovers folders via import.meta.glob — nothing to register.
import type { ComponentType } from "react";

export interface WidgetWindowConfig {
  title?: string;
  width?: number;
  height?: number;
  /** First-launch position only — tauri-plugin-window-state persists wherever the user drags it. */
  x?: number;
  y?: number;
}

export interface WidgetModule {
  default: ComponentType;
  windowConfig?: WidgetWindowConfig;
}
