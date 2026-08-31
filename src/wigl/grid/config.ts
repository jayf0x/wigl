// Every tunable of the tiling desktop in one place. Sizes are CSS px.
export const TILING = {
  cell: 72, // px per grid cell
  gap: 10, // px between cells
  // Margin around the grid. Top is larger so widgets clear the macOS menu bar.
  padding: { top: 48, right: 24, bottom: 24, left: 24 },
  cols: null as number | null, // fixed column count; null = fill screen width
  rows: null as number | null, // max rows a drag can target; null = unlimited
  // A widget's real size isn't known until its own <Widget w h> mounts and
  // reports in (see widget.tsx) — this placeholder is what a not-yet-mounted
  // widget occupies for the first layout pass.
  defaultSize: { w: 3, h: 4 },
  // Settle animation. Lower damping = bouncier, higher stiffness = snappier.
  spring: { stiffness: 180, damping: 16 },
  liftScale: 1.02, // dragged card grows this much
  // The anchor field: cross marks on cell corners that wake while dragging.
  field: {
    show: "drag" as "drag" | "always" | "never",
    influence: 150, // px radius around the cursor where anchors react
  },
};

// The subset the Settings > Grid section can tune, snapshotted at module
// load (before main.tsx merges any Tier-2 override in) so "reset to default"
// has a real baseline to fall back to. Only these five fields — the rest of
// TILING (spring, liftScale, field) has no UI.
const GRID_DEFAULTS = {
  cell: TILING.cell,
  gap: TILING.gap,
  cols: TILING.cols,
  rows: TILING.rows,
  padding: { ...TILING.padding },
};

export type GridOverrides = {
  cell?: number;
  gap?: number;
  cols?: number | null;
  rows?: number | null;
  padding?: Partial<typeof GRID_DEFAULTS.padding>;
};

// Applies a Grid-settings override object onto the live TILING object in
// place — grid math reads TILING per call (grid/math.ts), so mutating it and
// rebuilding the layout is all it takes to retune the grid without a
// restart. Every field falls back to its default when absent, so passing
// `{}` is a genuine reset. Desktop.tsx calls this on the `wigl-grid`
// broadcast the Grid section emits.
export const applyGridOverrides = (o: GridOverrides): void => {
  TILING.cell = typeof o.cell === "number" && o.cell > 0 ? o.cell : GRID_DEFAULTS.cell;
  TILING.gap = typeof o.gap === "number" && o.gap >= 0 ? o.gap : GRID_DEFAULTS.gap;
  TILING.cols = typeof o.cols === "number" && o.cols > 0 ? o.cols : GRID_DEFAULTS.cols;
  TILING.rows = typeof o.rows === "number" && o.rows > 0 ? o.rows : GRID_DEFAULTS.rows;
  TILING.padding = { ...GRID_DEFAULTS.padding, ...o.padding };
};
