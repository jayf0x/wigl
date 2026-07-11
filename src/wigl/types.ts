// The full widget contract. A widget is a folder: src/widgets/<name>/index.tsx
// default-exporting a component, optionally exporting `gridConfig`.
// App.tsx discovers folders via import.meta.glob — nothing to register.
import type { ComponentType } from "react";

/** All values are grid cells (see tiling.config.ts for the cell size). */
export interface WidgetGridConfig {
  /** Width in cells. Default 3. */
  w?: number;
  /** Height in cells. Default 4. */
  h?: number;
  /** First-launch cell position only — the tiling desktop persists wherever the user drags it. */
  x?: number;
  y?: number;
}

export interface WidgetModule {
  default: ComponentType;
  gridConfig?: WidgetGridConfig;
}
