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
