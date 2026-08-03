import type { ComponentType } from "react";

/** Every capability a plugin can ask for. Declaring one in `manifest.json`
 * is what makes the matching host module (or module member) resolvable at
 * all — see `registry.ts`. Undeclared means the import throws at load time,
 * not "works but shouldn't have", which is the whole point of the list. */
export type WidgetPermission = "command" | "filesystem" | "network" | "storage";

/** The host runtime's contract version. A plugin declares which one it was
 * built against; the loader refuses anything it doesn't speak, so an old
 * plugin fails loudly instead of half-working against a moved API. Bump
 * this whenever a host module is removed or changes shape. */
export const PLUGIN_API_VERSION = 1;

/** `manifest.json` — the one required file in a plugin folder. Deliberately
 * not `package.json`: that name implies npm semantics (a dependency list
 * something installs for you), and a plugin's dependencies are bundled at
 * build time, never resolved at runtime. Different contract, different file. */
export interface WidgetManifest {
  /** Folder-safe id. Doubles as the storage-key namespace and the grid id,
   * so it has the same reserved names as a builtin folder: not `main`
   * (the bootstrap window's label) and not `wigl` (the app itself). */
  id: string;
  name: string;
  version: string;
  /** Path, relative to the plugin folder, of the *built* ESM entry — not the
   * `.tsx` source. A webview has no compiler; `bun run plugin:build` is what
   * turns source into this file. */
  entry: string;
  apiVersion: number;
  permissions?: WidgetPermission[];
  description?: string;
}

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
