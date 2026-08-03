import type { ComponentType } from "react";

/** Every capability a plugin can ask for. Declaring one under package.json's
 * `wigl.permissions` is what makes the matching host module (or module
 * member) resolvable at all — see `registry.ts`. Undeclared means the
 * import throws at load time, not "works but shouldn't have", which is the
 * whole point of the list. */
export type WidgetPermission = "command" | "filesystem" | "network" | "storage";

/** Where a plugin's built entry lives if it doesn't say otherwise. A plugin
 * with its own `package.json` can override this via `main`, same field Node
 * already uses for "here's the entry point" — no bespoke schema to learn. */
export const DEFAULT_PLUGIN_ENTRY = "dist/index.js";

export const RESERVED_PLUGIN_IDS = new Set(["main", "wigl"]);

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
 * zero-config plugin (entry defaults to `dist/index.js`, no permissions). */
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
}
