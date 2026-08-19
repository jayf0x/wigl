import type { ComponentType } from "react";
import { join } from "@tauri-apps/api/path";
import { storageRoot } from "@/wigl/settings/config";
import { registerSettingsSection } from "@/wigl/settings/registry";
import type { SettingSection } from "@/wigl/settings/types";
import { sql, sqlLiteral } from "@/wigl/storage/client";
import { runCmd } from "@/wigl/utils";
import { type WidgetInstances, WIDGET_INSTANCES_KEY } from "./instances";
import type { createPluginRequire } from "./registry";
import {
  BACKGROUND_PLUGIN_ID,
  type FailedPlugin,
  type LoadedPlugin,
  type PluginLoadResult,
  RESERVED_PLUGIN_IDS,
  resolvePluginConfig,
} from "./types";

// How an installed plugin actually gets into the running app:
//
//   ~/.local/share/<identifier>/plugins/<id>/
//     {package.json?, .wigl/index.js, .wigl/index.css?}
//        ↓ read as text (sh -c cat — same "shell out, no new Rust" rule as
//          storage; no asset-protocol config, no new capability entry)
//        ↓ index.css, if present, → injectStyle() → a <style> tag
//   source string + a per-plugin header binding __wigl_host
//        ↓ Blob + createObjectURL
//   dynamic import()  →  module.default  →  a React component
//
// Reading through `sh` rather than serving the file over Tauri's asset
// protocol is what keeps this a zero-config addition: `shell:allow-execute`
// already grants `sh`, so no capability, tauri.conf.json, or Rust change is
// needed to install a plugin. The tradeoff is that a blob module has no file
// path, so devtools shows the plugin as an anonymous blob URL — the build
// script inlines a sourcemap to put that back (see `scripts/widget.ts`).

interface PluginModule {
  default: ComponentType;
}

// A widget's contribution to the general Settings modal — the optional
// build output of a sibling `settings.tsx`/`settings.ts` (see
// scripts/widget.ts's findSettingsSource). Loaded and registered alongside
// the widget's component, not by it, so the section stays registered
// regardless of whether the widget is currently hidden/closed (see
// settings/registry.ts's registerSettingsSection).
interface SettingsModule {
  default?: SettingSection;
}

declare global {
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

/** `null` means "no package.json" (a valid, zero-config plugin), not an
 * error — only a missing *entry* file should fail a load. */
const tryReadFile = async (path: string): Promise<string | null> => {
  const out = await runCmd("sh", ["-c", `cat ${shq(path)} 2>/dev/null`]);
  return out.code === 0 ? out.stdout : null;
};

/** Where installed plugins live. Sibling of `wigl.db` under storageRoot()
 * (the OS's app-data dir unless a storage.root override relocates it, see
 * settings/config.ts), so "everything wigl owns on disk" stays one folder. */
export const pluginsDir = async () => join(await storageRoot(), "plugins");

/** A plugin's own `import "./x.css"` builds to a sibling `index.css` next to
 * `index.js` (`scripts/widget.ts`'s `cssSibling`) — installed alongside it,
 * so a real stylesheet works despite the plugin loading as one JS blob with
 * no bundler-level CSS pipeline of its own. Injected as a `<style>` tag
 * (never a widget's job to do this itself): the text is build-time plugin
 * source, not runtime/user-controlled content, so `.textContent` — not
 * `dangerouslySetInnerHTML` — is the right tool and carries none of that
 * ban's risk. Keyed by plugin id and de-duped so reloading (or a second
 * monitor's own JS realm re-running `loadPlugins`) never doubles it up. */
const injectStyle = (id: string, css: string) => {
  const key = `data-wigl-plugin-style-${id}`;
  if (document.head.querySelector(`style[${key}]`)) return;
  const style = document.createElement("style");
  style.setAttribute(key, "");
  style.textContent = css;
  document.head.appendChild(style);
};

/** Loads one *instance* of a folder. `instanceId` is what everything
 * runtime-scoped (require, `useStorage`/`useQuery` key prefix, the
 * `widgets` map key in Desktop.tsx) binds to — `folder` is only ever used
 * to find the code on disk and to resolve `entry`/`permissions` (folder
 * identity, see types.ts). Calling this more than once for the same folder
 * with different `instanceId`s (F6's "duplicate widget") re-reads and
 * re-evaluates the same source through a fresh blob URL each time — blob
 * URLs aren't content-addressed, so a fresh `URL.createObjectURL` forces a
 * fresh module evaluation, which is what gives each instance its own
 * `__wigl_host.require` closure bound to its own `instanceId` rather than
 * two mounts silently sharing the first one's storage/require scope. */
const loadOne = async (dir: string, folder: string, instanceId: string): Promise<LoadedPlugin> => {
  if (RESERVED_PLUGIN_IDS.has(folder)) throw new Error(`"${folder}" is a reserved id`);

  const pkgRaw = await tryReadFile(await join(dir, "package.json"));
  const { entry, permissions, instantiable } = resolvePluginConfig(folder, pkgRaw);
  const entryPath = await join(dir, entry);
  const code = await readFile(entryPath);
  const css = await tryReadFile(entryPath.replace(/\.js$/, ".css"));
  // Keyed by folder, not instanceId: every instance of one folder shares the
  // exact same CSS source, so injecting it again per instance would just be
  // a duplicate <style> tag injectStyle's own dedupe already exists to avoid.
  if (css) injectStyle(folder, css);
  // Settings-section metadata belongs to the folder, not any one instance —
  // registerSettingsSection is idempotent on the section's own (author-
  // chosen, fixed) id, so loading it again per extra instance would be pure
  // waste, and would rebind its useStorage calls to whichever instance
  // happened to load last. Base instance only.
  const settingsCode =
    instanceId === folder ? await tryReadFile(entryPath.replace(/[^/]+$/, "settingsSection.js")) : null;

  // Imported lazily, not at module top level: the registry holds a live
  // reference to every host module it can serve — including the whole of
  // `lucide-react` — so importing it eagerly would put the entire icon set
  // in the app's main chunk for every user, including those with no plugins
  // installed at all. This way that cost is paid on the first plugin load.
  const { createPluginRequire } = await import("./registry");
  globalThis.__wigl_scopes__ ??= {};
  globalThis.__wigl_scopes__[instanceId] = createPluginRequire(instanceId, permissions);

  // The header is prepended at load time rather than baked into the bundle
  // because the bundle can't know which plugin it'll be installed as — and
  // binding the scope by instanceId here is what stops one instance from
  // grabbing another's (more permissive, or just differently-scoped) require.
  const header = `const __wigl_host = { require: globalThis.__wigl_scopes__[${JSON.stringify(instanceId)}] };\n`;
  const url = URL.createObjectURL(new Blob([header, code], { type: "text/javascript" }));
  let component: ComponentType;
  try {
    const mod = (await import(/* @vite-ignore */ url)) as PluginModule;
    if (!mod.default) throw new Error("entry has no default export — it must default-export its component");
    component = mod.default;
  } finally {
    URL.revokeObjectURL(url);
  }

  if (settingsCode) {
    const settingsUrl = URL.createObjectURL(new Blob([header, settingsCode], { type: "text/javascript" }));
    try {
      const settingsMod = (await import(/* @vite-ignore */ settingsUrl)) as SettingsModule;
      if (settingsMod.default) registerSettingsSection(settingsMod.default);
    } finally {
      URL.revokeObjectURL(settingsUrl);
    }
  }

  return { manifest: { id: instanceId, folder, permissions, instantiable }, component };
};

/** Direct, unprefixed read of the core "which folders have extra instances"
 * record (instances.ts) — this runs host-side, before any plugin scope
 * exists to read it through, so it goes straight at the same kv table
 * useStorage/useQuery use rather than through a hook. Never throws: no
 * sqlite3 installed, or no row written yet, both just mean "no extra
 * instances anywhere" — same failure mode useStorage's own read already
 * tolerates. */
const readInstances = async (): Promise<WidgetInstances> => {
  try {
    const raw = (await sql(`SELECT value FROM kv WHERE key=${sqlLiteral(WIDGET_INSTANCES_KEY)}`)).trim();
    return raw ? (JSON.parse(raw) as WidgetInstances) : {};
  } catch (e) {
    console.error("[wigl] failed to read widget instances", e);
    return {};
  }
};

/** Discovers and mounts every installed plugin. Never throws: a plugin that
 * fails to load comes back in `failed` so the caller can surface it, because
 * the alternative — one bad plugin blanking every widget on the desktop —
 * is the failure mode this app's error boundaries exist to prevent. */
export const loadPlugins = async (): Promise<PluginLoadResult> => {
  const dir = await pluginsDir();
  const loaded: LoadedPlugin[] = [];
  const failed: FailedPlugin[] = [];
  let background: ComponentType | undefined;

  // `-1` one-per-line, and a missing directory is the normal first-run state,
  // not an error worth reporting.
  const ls = await runCmd("sh", ["-c", `ls -1 ${shq(dir)} 2>/dev/null || true`]);
  const folders = ls.stdout.split("\n").filter(Boolean);
  const instances = await readInstances();

  for (const folder of folders) {
    // The reserved background folder (F11 half 2) is a singleton special
    // case — same load path, but it never goes through the instance
    // machinery below (it isn't in the normal widgets grid at all, so
    // "duplicate" has no meaning for it).
    if (folder === BACKGROUND_PLUGIN_ID) {
      try {
        background = (await loadOne(await join(dir, folder), folder, folder)).component;
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.error(`[wigl] plugin "${folder}" failed to load:`, error);
        failed.push({ id: folder, error });
      }
      continue;
    }

    // Base instance id is always the folder id — the compatibility
    // guarantee that makes this whole feature transparent to every
    // single-instance widget that existed before it: its storage/layout
    // rows are keyed by the same id they always were, zero migration.
    // Extra instances (if any were ever duplicated) come from the one core
    // storage key instances.ts owns, keyed by folder.
    const instanceIds = [folder, ...(instances[folder] ?? [])];
    for (const instanceId of instanceIds) {
      try {
        const plugin = await loadOne(await join(dir, folder), folder, instanceId);
        if (instanceId !== folder && !plugin.manifest.instantiable) {
          // wigl.instantiable was flipped to false after a duplicate had
          // already been created — honor the current setting rather than
          // force a widget that says it can't handle a second instance to
          // run one anyway. The stale id stays recorded (instances.ts has
          // no prune step); it just stops loading until re-enabled.
          console.warn(
            `[wigl] plugin "${folder}" is no longer instantiable — skipping extra instance "${instanceId}"`,
          );
          continue;
        }
        loaded.push(plugin);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.error(`[wigl] plugin "${folder}" (instance "${instanceId}") failed to load:`, error);
        failed.push({ id: instanceId, error });
      }
    }
  }
  // One line, always — "did my plugin actually mount?" is otherwise
  // unanswerable from outside the app, and on Linux the WebKit console is
  // the only signal `scripts/verify.sh` can capture (see docs/debugging.md).
  console.info(
    `[wigl] plugins: ${loaded.length} loaded${failed.length ? `, ${failed.length} failed` : ""} from ${dir}${background ? " (+ background)" : ""}`,
  );
  return { loaded, failed, background };
};
