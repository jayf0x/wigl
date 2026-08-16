// Host-only barrel. Unlike `@/wigl`, `@/wigl/hooks` and `@/wigl/utils`, this
// one is *not* part of the widget-facing API: it's the machinery that mounts
// plugins, imported by `src/App.tsx` (the host shell) and nothing else. A
// widget importing from here would be importing the thing that loads it.
export { HOST_MODULE_IDS, type HostModuleId } from "./host-modules";
export { loadPlugins, pluginsDir } from "./loader";
export type { FailedPlugin, LoadedPlugin, PluginLoadResult, WidgetManifest, WidgetPermission } from "./types";
