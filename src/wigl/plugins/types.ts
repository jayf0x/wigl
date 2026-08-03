import type { ComponentType } from "react";

/** Every capability a plugin can ask for. Declaring one in `manifest.json`
 * is what makes the matching host module (or module member) resolvable at
 * all — see `registry.ts`. Undeclared means the import throws at load time,
 * not "works but shouldn't have", which is the whole point of the list. */
export type WidgetPermission = "command" | "filesystem" | "network" | "storage";

/** The host runtime's contract version. Not something a plugin author picks
 * or writes — `bun run plugin:build` stamps the current value onto the
 * manifest at build time, and the loader refuses to mount anything that
 * doesn't match, so a plugin built against a host that's since moved on
 * fails loudly instead of half-working against an API that no longer
 * exists. Bump this whenever a host module is removed or changes shape. */
export const PLUGIN_API_VERSION = 1;

/** Every built plugin's entry lives at this fixed path relative to its
 * folder. Not configurable — one location for every plugin means the loader
 * and the build script never need a field to agree on. */
export const PLUGIN_ENTRY = "dist/index.js";

/** `manifest.json` — the one required file in a plugin folder. Deliberately
 * not `package.json`: that name implies npm semantics (a dependency list
 * something installs for you), and a plugin's dependencies are bundled at
 * build time, never resolved at runtime. Different contract, different file.
 *
 * Kept to exactly the fields something reads: `id` gates identity/storage
 * namespace, `apiVersion` gates host compatibility, `permissions` gates
 * capabilities (see `registry.ts`). `name`/`version`/`description` used to
 * live here too; nothing ever read them, so they're gone — a plugin author
 * puts that in their own README. */
export interface WidgetManifest {
  /** Folder-safe id. Doubles as the storage-key namespace and the grid id.
   * Not `main` (the bootstrap window's label) or `wigl` (the app itself). */
  id: string;
  /** Optional in the *source* file — a plugin author never writes this,
   * `plugin:build`/`plugin:install` stamp it onto the installed copy (see
   * `PLUGIN_API_VERSION`). Always present once installed, which is the only
   * place the loader ever reads it. */
  apiVersion?: number;
  permissions?: WidgetPermission[];
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
