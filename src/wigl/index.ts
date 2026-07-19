// Everything a widget imports from the app: import { Widget, WidgetHeader }
// from "@/wigl". Future shared hooks/utils export from here too — widgets
// never deep-import wigl internals.
export { Widget, WidgetHeader } from "./widget";
export { Desktop } from "./Desktop";
export { useStorage } from "./storage";
export { useQuery, hours, type UseQueryOptions } from "./query";
export { relativeTime, useRelativeTime } from "./relativeTime";
export { TILING } from "./tiling.config";
export { DESKTOP_ACTIONS, type DesktopAction, type DesktopActionCtx } from "./actions";
export type { WidgetModule } from "./types";
export type { WidgetGridProps } from "./widget";
