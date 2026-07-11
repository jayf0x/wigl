// Everything a widget imports from the app: import { Widget, WidgetHeader,
// type WidgetWindowConfig } from "@/wigl". Future shared hooks/utils export
// from here too — widgets never deep-import wigl internals.
export { Widget, WidgetHeader } from "./widget";
export { useStorage } from "./storage";
export { relativeTime, useRelativeTime } from "./relativeTime";
export type { WidgetModule, WidgetWindowConfig } from "./types";
