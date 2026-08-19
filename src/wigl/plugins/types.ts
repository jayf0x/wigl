import type { ComponentType } from "react";

/** Every capability a plugin can ask for. Declaring one under package.json's
 * `wigl.permissions` is what makes the matching host module (or module
 * member) resolvable at all — see `registry.ts`. Undeclared means the
 * import throws at load time, not "works but shouldn't have", which is the
 * whole point of the list. */
export type WidgetPermission = "command" | "filesystem" | "network" | "storage" | "pty";

/** Where a plugin's built entry lives if it doesn't say otherwise. A plugin
 * with its own `package.json` can override this via `main`, same field Node
 * already uses for "here's the entry point" — no bespoke schema to learn.
 * `.wigl/`, not `dist/`: dot-prefixed keeps the build machinery out of a
 * casual look at the folder (same convention as `.next/`/`.svelte-kit/`) —
 * a widget author who never touches the build should see source files, not
 * output. */
export const DEFAULT_PLUGIN_ENTRY = ".wigl/index.js";

export const RESERVED_PLUGIN_IDS = new Set(["main", "wigl"]);

/** The one *other* reserved folder id, deliberately kept out of
 * `RESERVED_PLUGIN_IDS` above — "main"/"wigl" can never be loaded as
 * anything, but "background" is the opposite: a valid, specially-handled
 * plugin folder (F11 half 2). It goes through the exact same build/install/
 * load machinery as any ordinary widget (readWidgetConfig, loadOne, the
 * host-module registry) — it just isn't required to render a `<Widget>`
 * root (scripts/widget.ts's `check()` special-cases this id) and, once
 * loaded, is routed to `PluginLoadResult.background` instead of the normal
 * `loaded` widget list (see loader.ts's `loadPlugins()`) so `Desktop.tsx`
 * mounts it full-bleed behind the grid rather than as a tiled `<Widget>`
 * item. */
export const BACKGROUND_PLUGIN_ID = "background";

/** The bits of `package.json` wigl actually reads. Not a full npm manifest
 * type — a plugin's `package.json` is otherwise ordinary (name/version/
 * dependencies/whatever the author wants), the host just never looks at the
 * rest of it. `wigl` is a namespaced key, same convention as
 * `eslintConfig`/`browserslist`/`lint-staged` — no separate config file. */
interface PluginPackageJson {
  main?: string;
  wigl?: { permissions?: WidgetPermission[] };
}

/** A plugin's resolved identity: no manifest.json, no id/apiVersion fields
 * to hand-write. `id` is always the folder name — it's already required to
 * be unique (two plugins can't share a folder), so a second place to spell
 * it out would only be one more thing to keep in sync. `entry`/`permissions`
 * come from an optional `package.json`; no `package.json` at all is a valid,
 * zero-config plugin (entry defaults to `DEFAULT_PLUGIN_ENTRY`, no permissions). */
export interface WidgetManifest {
  id: string;
  permissions: WidgetPermission[];
}

/** `raw` is the plugin folder's `package.json` text, or `null` if it has
 * none — both the loader (runtime, reading through `sh`) and `scripts/
 * plugin.ts` (build time, reading through `Bun.file`) call this the same
 * way once they have the text, so "what does an empty/partial package.json
 * mean" is defined in exactly one place. */
export const resolvePluginConfig = (
  folder: string,
  raw: string | null,
): { id: string; entry: string; permissions: WidgetPermission[] } => {
  const pkg = raw ? (JSON.parse(raw) as PluginPackageJson) : {};
  return {
    id: folder,
    entry: pkg.main ?? DEFAULT_PLUGIN_ENTRY,
    permissions: pkg.wigl?.permissions ?? [],
  };
};

export interface LoadedPlugin {
  manifest: WidgetManifest;
  component: ComponentType;
}

/** A plugin that was found on disk but couldn't be mounted. Kept as data
 * rather than thrown, so one broken plugin surfaces as a message instead of
 * taking the whole discovery pass (and every other plugin) down with it. */
export interface FailedPlugin {
  id: string;
  error: string;
}

export interface PluginLoadResult {
  loaded: LoadedPlugin[];
  failed: FailedPlugin[];
  /** The installed `background` plugin's component, if that reserved folder
   * (`BACKGROUND_PLUGIN_ID` above) is present and loaded successfully —
   * absent otherwise. Never appears in `loaded`/the normal widgets map. */
  background?: ComponentType;
}
