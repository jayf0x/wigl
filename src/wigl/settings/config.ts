// Tier-2 settings: one JSON file of *overrides* (app_data_dir()/wigl-config.json,
// written natively by the config_get/config_set Rust commands — same atomic
// tmp+rename precedent as secrets.json, see src-tauri/src/lib.rs), merged
// over each module's own compile-time defaults once at startup (main.tsx
// awaits hydrateConfig() before the first render). Restart-required by rule
// (see todo-settings-ui.md's "Storage" section) — nothing here is re-read
// after hydrate() resolves, so a field changed via the Settings modal only
// takes effect on the next launch; there's no live-mutation path to keep
// correct.
import { invoke } from "@tauri-apps/api/core";
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

/**
 * One level of recursive merge over `target` — enough for TILING's shape
 * (padding/spring/field are flat objects, never nested further). Mutates
 * `target` in place so an already-imported reference (grid/config.ts's
 * TILING) picks the override up; call once, at startup, after hydrateConfig()
 * resolves — see main.tsx.
 */
export const mergeConfigInto = <T extends Record<string, unknown>>(target: T, namespace: string): T => {
  const overrides = cached[namespace];
  if (!isPlainObject(overrides)) return target;
  const t = target as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    const current = t[key];
    if (isPlainObject(current) && isPlainObject(value)) Object.assign(current, value);
    else t[key] = value;
  }
  return target;
};

/** The currently-saved override object for one namespace (`"grid"`, ...) —
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
