// The app's shared visual/layout primitives: import { Desktop, Widget,
// WidgetHeader, TILING } from "@/wigl". Non-visual helpers live in their own
// barrels — import { useStorage, useQuery, ... } from "@/wigl/hooks" and
// import { cn, isMacos, ... } from "@/wigl/utils". Widgets never deep-import
// past these three barrels.
export { Desktop } from "./Desktop";
export { TILING } from "./grid/config";
export type { WidgetGridProps } from "./widget";
export { Widget, WidgetHeader } from "./widget";
