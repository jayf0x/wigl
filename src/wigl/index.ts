// Everything a widget imports from the app: import { Widget, WidgetHeader }
// from "@/wigl". Future shared hooks/utils export from here too — widgets
// never deep-import wigl internals.

export { DESKTOP_ACTIONS, type DesktopAction, type DesktopActionCtx } from "./actions";
export { Desktop } from "./Desktop";
export { isMacos } from "./platform";
export { hours, type UseQueryOptions, useQuery } from "./query";
export { relativeTime, useRelativeTime } from "./relativeTime";
export { useStorage } from "./storage";
export { TILING } from "./tiling.config";
export type { WidgetModule } from "./types";
export type { WidgetGridProps } from "./widget";
export { Widget, WidgetHeader } from "./widget";
