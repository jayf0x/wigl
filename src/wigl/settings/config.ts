// Tier-2 settings: one JSON file of *overrides* (app_data_dir()/wigl-config.json,
// written natively by the config_get/config_set Rust commands — same atomic
// tmp+rename precedent as secrets.json, see src-tauri/src/lib.rs), read once
// at startup (main.tsx awaits hydrateConfig() before the first render).
// Restart-required by rule: nothing here is re-read after hydrate() resolves,
// so a field changed via the Settings modal only takes effect on the next
// launch. This tier is now only `storage.root` (where the db/plugins live —
// can't move mid-session) and `app.mode` (windowed/overlay — restarts
// itself). Anything that *can* apply live belongs in `useStorage` instead,
// like Settings > Grid does (see settings/sections/grid.tsx).
import { invoke } from "@tauri-apps/api/core";
import { appDataDir as tauriAppDataDir } from "@tauri-apps/api/path";
import { markRestartRequired } from "./restartBanner";

export type ConfigOverrides = Record<string, unknown>;

const readConfigOverrides = (): Promise<ConfigOverrides> => invoke("config_get");
const writeConfigOverrides = (config: ConfigOverrides): Promise<void> => invoke("config_set", { config });

let cached: ConfigOverrides = {};
let hydrating: Promise<ConfigOverrides> | null = null;

/** Reads wigl-config.json once, before the app's first render (see
 * main.tsx). Safe to call more than once — every call after the first
 * awaits the same in-flight read. */
export const hydrateConfig = (): Promise<ConfigOverrides> => {
  hydrating ??= readConfigOverrides()
    .then((c) => (cached = c))
    .catch((e) => {
      console.error("[wigl] config hydrate failed, using defaults", e);
      return cached;
    });
  return hydrating;
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The currently-saved override object for one namespace (`"storage"`, ...) —
 * what a settings section reads to show its fields' current values.
 * Distinct from mergeConfigInto: a section edits this raw override object,
 * not the already-merged live defaults. */
export const getConfigOverrides = (namespace: string): Record<string, unknown> => {
  const overrides = cached[namespace];
  return isPlainObject(overrides) ? overrides : {};
};

/** Persists a namespace's override object and flags a restart as required —
 * every Tier-2 write goes through here so that flag can never be forgotten
 * at a call site. */
export const setConfigOverride = async (namespace: string, next: Record<string, unknown>): Promise<void> => {
  cached = { ...cached, [namespace]: next };
  await writeConfigOverrides(cached);
  markRestartRequired();
};

/** Where the db, plugins, etc. actually live — the OS's `app_data_dir()`
 * unless a `storage.root` override is set (see settings/sections/storage.tsx).
 * `wigl-config.json` itself never moves (see config_path in lib.rs) — this
 * is the only file that has to live at a fixed, guessable location, since
 * it's what tells every other path where to look. Callers must await
 * hydrateConfig() first (main.tsx already does, before the first render),
 * same requirement mergeConfigInto/getConfigOverrides have. */
export const storageRoot = async (): Promise<string> => {
  const root = getConfigOverrides("storage").root;
  return typeof root === "string" && root ? root : tauriAppDataDir();
};
