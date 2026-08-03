import type { ComponentType } from "react";
import { appDataDir, join } from "@tauri-apps/api/path";
import { runCmd } from "@/wigl/utils";
import type { createPluginRequire } from "./registry";
import {
  type FailedPlugin,
  type LoadedPlugin,
  PLUGIN_API_VERSION,
  type PluginLoadResult,
  type WidgetManifest,
} from "./types";

// How an installed plugin actually gets into the running app:
//
//   ~/.local/share/<identifier>/plugins/<id>/{manifest.json,dist/index.js}
//        ↓ read as text (sh -c cat — same "shell out, no new Rust" rule as
//          storage; no asset-protocol config, no new capability entry)
//   source string + a per-plugin header binding __wigl_host
//        ↓ Blob + createObjectURL
//   dynamic import()  →  module.default  →  a React component
//
// Reading through `sh` rather than serving the file over Tauri's asset
// protocol is what keeps this a zero-config addition: `shell:allow-execute`
// already grants `sh`, so no capability, tauri.conf.json, or Rust change is
// needed to install a plugin. The tradeoff is that a blob module has no file
// path, so devtools shows the plugin as an anonymous blob URL — the build
// script inlines a sourcemap to put that back (see `scripts/plugin.ts`).

interface PluginModule {
  default: ComponentType;
}

declare global {
  // biome-ignore lint/style/noVar: `declare global` requires var
  var __wigl_scopes__: Record<string, ReturnType<typeof createPluginRequire>> | undefined;
}

/** Single-quote for `sh -c`. Paths come from `appDataDir()` and a folder
 * listing rather than user input, but they still pass through a shell, and
 * "the untrusted part is elsewhere" is exactly how quoting bugs get shipped. */
const shq = (s: string) => `'${s.split("'").join(`'\\''`)}'`;

const readFile = async (path: string): Promise<string> => {
  const out = await runCmd("sh", ["-c", `cat ${shq(path)}`]);
  if (out.code !== 0) throw new Error(`cannot read ${path}: ${out.stderr.trim()}`);
  return out.stdout;
};

/** Where installed plugins live. Sibling of `wigl.db` in the same per-OS
 * app-data dir, so "everything wigl owns on disk" stays one folder. */
export const pluginsDir = async () => join(await appDataDir(), "plugins");

const RESERVED_IDS = new Set(["main", "wigl"]);

const parseManifest = (raw: string, folder: string): WidgetManifest => {
  const m = JSON.parse(raw) as Partial<WidgetManifest>;
  if (!m.id) throw new Error("manifest.json has no `id`");
  if (m.id !== folder) throw new Error(`manifest id "${m.id}" doesn't match folder name "${folder}"`);
  if (RESERVED_IDS.has(m.id)) throw new Error(`"${m.id}" is a reserved id`);
  if (!m.entry) throw new Error("manifest.json has no `entry` — point it at the built ESM file, not the .tsx source");
  if (m.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(`built for plugin API v${m.apiVersion}, this wigl speaks v${PLUGIN_API_VERSION}`);
  }
  return m as WidgetManifest;
};

const loadOne = async (dir: string, folder: string): Promise<LoadedPlugin> => {
  const manifest = parseManifest(await readFile(await join(dir, "manifest.json")), folder);
  const code = await readFile(await join(dir, manifest.entry));

  // Imported lazily, not at module top level: the registry holds a live
  // reference to every host module it can serve — including the whole of
  // `lucide-react` — so importing it eagerly would put the entire icon set
  // in the app's main chunk for every user, including those with no plugins
  // installed at all. This way that cost is paid on the first plugin load.
  const { createPluginRequire } = await import("./registry");
  globalThis.__wigl_scopes__ ??= {};
  globalThis.__wigl_scopes__[manifest.id] = createPluginRequire(manifest.id, manifest.permissions ?? []);

  // The header is prepended at load time rather than baked into the bundle
  // because the bundle can't know which plugin it'll be installed as — and
  // binding the scope by id here is what stops one plugin from grabbing
  // another's (more permissive) require.
  const header = `const __wigl_host = { require: globalThis.__wigl_scopes__[${JSON.stringify(manifest.id)}] };\n`;
  const url = URL.createObjectURL(new Blob([header, code], { type: "text/javascript" }));
  try {
    const mod = (await import(/* @vite-ignore */ url)) as PluginModule;
    if (!mod.default) throw new Error("entry has no default export — it must default-export its component");
    return { manifest, component: mod.default };
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** Discovers and mounts every installed plugin. Never throws: a plugin that
 * fails to load comes back in `failed` so the caller can surface it, because
 * the alternative — one bad manifest blanking every widget on the desktop —
 * is the failure mode this app's error boundaries exist to prevent. */
export const loadPlugins = async (): Promise<PluginLoadResult> => {
  const dir = await pluginsDir();
  const loaded: LoadedPlugin[] = [];
  const failed: FailedPlugin[] = [];

  // `-1` one-per-line, and a missing directory is the normal first-run state,
  // not an error worth reporting.
  const ls = await runCmd("sh", ["-c", `ls -1 ${shq(dir)} 2>/dev/null || true`]);
  const folders = ls.stdout.split("\n").filter(Boolean);

  for (const folder of folders) {
    try {
      loaded.push(await loadOne(await join(dir, folder), folder));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[wigl] plugin "${folder}" failed to load:`, error);
      failed.push({ id: folder, error });
    }
  }
  // One line, always — "did my plugin actually mount?" is otherwise
  // unanswerable from outside the app, and on Linux the WebKit console is
  // the only signal `scripts/verify.sh` can capture (see docs/debugging.md).
  console.info(
    `[wigl] plugins: ${loaded.length} loaded${failed.length ? `, ${failed.length} failed` : ""} from ${dir}`,
  );
  return { loaded, failed };
};
