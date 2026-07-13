// The full widget contract. A widget is a folder: src/widgets/<name>/index.tsx
// with exactly one export — a default-exported component. Grid size/position
// are plain props on <Widget w h x y> (see widget.tsx), not a second export.
// App.tsx discovers folders via import.meta.glob — nothing to register.
import type { ComponentType } from "react";

export interface WidgetModule {
  default: ComponentType;
}
