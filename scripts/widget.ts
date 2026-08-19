#!/usr/bin/env bun
/**
 * Widget CLI — build / install / list / rm.
 *
 *   bun run widget:build       wigl-widgets/calendar   # one widget
 *   bun run widget:build                               # every wigl-widgets/<name> folder
 *   bun run widget:install     wigl-widgets/calendar   # build, then copy into app data
 *   bun run widget:install                             # build+install every widget
 *   bun run widget:list
 *   bun run widget:rm          calendar
 *
 * Why a build step exists at all: a webview has no compiler, so it cannot
 * import a `.tsx` file. Shipping one in the app (esbuild-wasm and friends)
 * would add ~9MB to a desktop-widget app to save widget authors a command.
 * `Bun.build` does it here instead — no new dependency, since the repo
 * already requires bun. A widget that ships hand-written, already-built JS
 * (no TypeScript, no `wigl` build tooling at all) skips this step entirely —
 * `widget:install` only builds when there's an `index.tsx`/`index.ts` to
 * build, otherwise it installs whatever's already sitting at the resolved
 * entry path.
 *
 * The important part isn't the bundling, it's the externals: every specifier
 * in HOST_MODULE_IDS is rewritten to a `__wigl_host.require(...)` call the
 * host answers at load time (see `src/wigl/plugins/loader.ts`). That's what
 * keeps exactly one React in the process, and it's what makes permissions
 * enforceable rather than decorative.
 */
import { cp, mkdir, mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { HOST_MODULE_IDS } from "../src/wigl/plugins/host-modules";
import { RESERVED_PLUGIN_IDS, resolvePluginConfig } from "../src/wigl/plugins/types";

// scripts/widget.ts -> repo root. Every repo-relative path below is resolved
// against *this*, not `process.cwd()` — a bare relative string like
// "wigl-widgets" only happens to work when invoked via `bun run widget:*`
// (which always sets cwd to the package.json's own dir); called any other
// way (a global alias, a different starting directory) it would silently
// resolve against wherever the caller happened to be instead. `scripts/wigl.ts`
// already gets this right; this mirrors it.
const repoRoot = resolve(import.meta.dir, "..");

// Override for a widgets folder that lives outside this repo (a personal
// widget stash, or the e2e suite under tests/e2e/ proving the tooling
// isn't secretly repo-root-coupled — see tests/e2e/README.md). Only the
// no-arg "every widget" sweep reads this; `widget:build <dir>`/`widget:install
// <dir>` already take any path, in or out of the repo, with no override needed.
// A relative override is resolved against repoRoot (not cwd) for the same
// reason as everything else here; an absolute override is used as-is.
const WIDGETS_ROOT = resolve(repoRoot, process.env.WIGL_WIDGETS_ROOT ?? "wigl-widgets");
// "types": widget:types' generated .d.ts output. "node_modules": present at
// widgets-root level only when a devkit's react type deps were copied
// alongside it (widget:devkit, see tests/e2e/README.md) — a widget's own
// deps live inside its own folder, never at the root.
const NON_WIDGET_DIRS = new Set(["types", "node_modules"]);
// A leading "_" opts a wigl-widgets/ folder out of discovery/build entirely —
// e.g. `_qa-color`, a dev-only QA surface with no reason to ship.

// Mirrors Tauri's `appDataDir()` for this app's identifier. Kept in sync
// with `src/config/app.ts` by reading the same source of truth Tauri does.
// `WIGL_APP_DATA_DIR` overrides the whole thing — the e2e suite sets it to a
// throwaway temp dir so a test install never touches the real app's plugins.
const identifier = (await Bun.file(join(repoRoot, "src-tauri/tauri.conf.json")).json()).identifier as string;
const appDataDir = () => {
  if (process.env.WIGL_APP_DATA_DIR) return process.env.WIGL_APP_DATA_DIR;
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", identifier);
  if (process.platform === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), identifier);
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), identifier);
};

// `wigl-config.json` never moves (see lib.rs's config_path) — it's what
// tells every other path where to look, same ordering rule the running app
// itself follows (settings/config.ts's storageRoot). Read once, here,
// rather than per install-root call: this is a one-shot CLI process, not a
// long-lived app that could see the override change mid-run.
const storageRootOverride = await Bun.file(join(appDataDir(), "wigl-config.json"))
  .json()
  .then((c) => (typeof c?.storage?.root === "string" && c.storage.root ? (c.storage.root as string) : null))
  .catch(() => null);
const installRoot = () => join(storageRootOverride ?? appDataDir(), "plugins");

const die = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

/** Every path a command touches ultimately comes from a CLI arg or the
 * `WIGL_WIDGETS_ROOT` env var — either can point at a typo'd or not-yet-created
 * path. Failing loudly here beats the alternative: `readdir`/`Bun.file` calls
 * further down silently seeing "nothing there" and reporting it as "0 widgets
 * found" or "no entry to build", which reads like an empty-but-valid state
 * instead of the misconfiguration it actually is. */
const requireDirExists = async (dir: string, what: string) => {
  const s = await stat(dir).catch(() => null);
  if (!s) die(`${what} "${dir}" does not exist`);
  if (!s.isDirectory()) die(`${what} "${dir}" is not a directory`);
};

/** Bun picks the JSX transform (`jsx` vs `jsxDEV`) and resolves React's
 * dev-vs-production build from NODE_ENV *at process start* — no build option
 * or later assignment overrides it. The app ships production React, and the
 * two are not interchangeable: a `jsxDEV` call into a production React is
 * exactly the "dispatcher.getOwner is not a function" crash this cost once
 * already. So building or checking under the wrong NODE_ENV is refused
 * outright rather than producing a bundle that looks fine and isn't. The
 * `widget:*` package scripts set it; this is the guard for anyone invoking
 * the script directly. */
const requireProductionEnv = (what: string) => {
  if (process.env.NODE_ENV !== "production") {
    die(`${what} must run with NODE_ENV=production (use \`bun run widget:${what}\`, which sets it)`);
  }
};

/** No manifest.json: id is the folder name, entry/permissions come from an
 * optional package.json (`resolvePluginConfig` in types.ts — the same
 * resolution the runtime loader uses). No package.json at all is valid: a
 * zero-config widget defaults to `.wigl/index.js`, no permissions. */
const readWidgetConfig = async (dir: string) => {
  const id = basename(dir);
  if (RESERVED_PLUGIN_IDS.has(id)) die(`"${id}" is a reserved id`);
  const pkgFile = Bun.file(join(dir, "package.json"));
  const raw = (await pkgFile.exists()) ? await pkgFile.text() : null;
  return { ...resolvePluginConfig(id, raw), pkgRaw: raw };
};

const findEntrySource = (dir: string) =>
  ["index.tsx", "index.ts"].map((f) => join(dir, f)).find((p) => Bun.file(p).size >= 0);

/** Optional sibling of index.tsx — a widget's contribution to the general
 * Settings modal (default-exports a `SettingSection`), built and installed
 * alongside the entry so it can be registered independently of the widget's
 * own mount lifecycle (see loader.ts's loadOne and settings/registry.ts).
 * Named distinctly from a plain "settings" — a widget's own internal
 * settings-panel component (`repos/Settings.tsx`) is a realistic name
 * collision on a case-insensitive filesystem (verified live: macOS APFS
 * treats "settings.tsx" and "Settings.tsx" as the same path), and unlike
 * `findEntrySource` this one must actually distinguish "present" from
 * "absent" since most widgets have no settings section at all. */
const findSettingsSource = async (dir: string): Promise<string | undefined> => {
  for (const f of ["settingsSection.tsx", "settingsSection.ts"]) {
    const p = join(dir, f);
    if (await Bun.file(p).exists()) return p;
  }
  return undefined;
};

/** Rewrites every host specifier to a CommonJS shim over `__wigl_host`.
 * CJS rather than ESM because the set of named exports isn't knowable at
 * build time (the host's modules aren't parsed here) — Bun's interop turns
 * `import { useState } from "react"` into a property read on the object the
 * host hands back, which is exactly the indirection we want. */
const hostExternals = {
  name: "wigl-host-externals",
  setup(build: Bun.PluginBuilder) {
    const filter = new RegExp(`^(${HOST_MODULE_IDS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})$`);
    build.onResolve({ filter }, (args) => ({ path: args.path, namespace: "wigl-host" }));
    build.onLoad({ filter: /.*/, namespace: "wigl-host" }, (args) => ({
      contents: `module.exports = __wigl_host.require(${JSON.stringify(args.path)});`,
      loader: "js" as const,
    }));
  },
};

const build = async (dir: string) => {
  requireProductionEnv("build");
  await requireDirExists(dir, "widget directory");
  const config = await readWidgetConfig(dir);
  const entrySrc = findEntrySource(dir);
  if (!entrySrc) {
    die(`${dir}: no index.tsx or index.ts to build (ships hand-written JS? skip widget:build, go straight to widget:install)`);
  }

  const outPath = join(dir, config.entry);
  const outdir = dirname(outPath);
  const settingsSrc = await findSettingsSource(dir);
  await rm(outdir, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: settingsSrc ? [entrySrc as string, settingsSrc] : [entrySrc as string],
    outdir,
    target: "browser",
    format: "esm",
    minify: false,
    // Inline, because a blob-loaded module has no file path for devtools to
    // resolve a sibling .map against (see loader.ts).
    sourcemap: "inline",
    plugins: [hostExternals],
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    die(`${config.id}: build failed`);
  }

  if (!(await Bun.file(outPath).exists())) {
    die(
      `${config.id}: build didn't produce "${config.entry}" — if package.json sets a custom "main", leave it as the default ".wigl/index.js" while using widget:build`,
    );
  }
  const size = (await stat(outPath)).size;
  // A plain `import "./foo.css"` anywhere in the widget's own source (never
  // through a host module — those are externalized) is handled by Bun.build's
  // built-in CSS loader: it bundles every such import into one sibling asset
  // named after the entry point, `index.js` → `index.css`, no config needed
  // (verified against a live Bun.build run, not assumed from docs). `install`
  // copies it alongside the JS, and `loader.ts` injects it as a `<style>` tag
  // at load time — see docs/widgets.md's "Build, install, and the plugin
  // mechanism" section.
  const cssPath = cssSibling(outPath);
  const hasCss = await Bun.file(cssPath).exists();
  const extras = [hasCss && "css", settingsSrc && "settings"].filter(Boolean).join(" + ");
  console.log(`✓ built ${config.id} → ${config.entry}${extras ? ` (+ ${extras})` : ""} (${(size / 1024).toFixed(1)}kb)`);
  return config;
};

/** `index.js` → `index.css` — Bun.build's own naming for a CSS asset
 * sibling of an entry point, given the entry's basename has no other dot. */
const cssSibling = (jsPath: string) => jsPath.replace(/\.js$/, ".css");

const install = async (dir: string) => {
  await requireDirExists(dir, "widget directory");
  const config = await readWidgetConfig(dir);
  const built = findEntrySource(dir) ? await build(dir) : config;
  const entryPath = join(dir, built.entry);
  if (!(await Bun.file(entryPath).exists())) {
    die(`${dir}: no index.tsx/ts and no built entry at "${built.entry}" — nothing to install`);
  }

  const target = join(installRoot(), built.id);
  // Only package.json, the entry file, its CSS sibling, and its settings.js
  // sibling (whichever the build produced) are installed — the widget's
  // other source, node_modules and tsconfig are build-time concerns with no
  // business sitting in a user's app-data dir.
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(join(target, built.entry)), { recursive: true });
  if (built.pkgRaw) await Bun.write(join(target, "package.json"), built.pkgRaw);
  await Bun.write(join(target, built.entry), Bun.file(entryPath));
  const cssSrc = cssSibling(entryPath);
  if (await Bun.file(cssSrc).exists()) {
    await Bun.write(join(target, cssSibling(built.entry)), Bun.file(cssSrc));
  }
  const settingsJs = join(dirname(entryPath), "settingsSection.js");
  if (await Bun.file(settingsJs).exists()) {
    await Bun.write(join(target, dirname(built.entry), "settingsSection.js"), Bun.file(settingsJs));
  }
  console.log(`✓ installed ${built.id} → ${target}`);
  console.log('  right-click the desktop → "Reload widgets" in a running wigl to see it (no restart needed).');
};

/** Every `wigl-widgets/<name>` folder, in the same order `ls` would give —
 * used when `build`/`install` are called with no dir so "do it to every
 * widget" is one command instead of one per folder. */
const allWidgetDirs = async (): Promise<string[]> => {
  await requireDirExists(
    WIDGETS_ROOT,
    process.env.WIGL_WIDGETS_ROOT ? "WIGL_WIDGETS_ROOT" : "widgets root",
  );
  const entries = await readdir(WIDGETS_ROOT, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory() && !NON_WIDGET_DIRS.has(e.name) && !e.name.startsWith("_"))
    .map((e) => resolve(WIDGETS_ROOT, e.name));
  if (!dirs.length) console.warn(`⚠ no widget folders found under "${WIDGETS_ROOT}"`);
  return dirs;
};

/** Removes any installed plugin whose source folder no longer qualifies —
 * deleted, or renamed to a `_`-prefixed (opted-out) folder. Without this, a
 * bulk `install` only ever adds/overwrites: an id installed by an earlier
 * run keeps loading forever even after its source is gone, since the
 * runtime loader reads app-data, never `wigl-widgets/` directly. Only runs
 * for the no-arg "install everything" form — a single-widget install has no
 * full picture of what should currently exist, so it can't safely prune. */
const pruneStaleInstalls = async (currentIds: Set<string>) => {
  const root = installRoot();
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.isDirectory() && !currentIds.has(e.name)) {
      await rm(join(root, e.name), { recursive: true, force: true });
      console.log(`✓ pruned stale install ${e.name} (no matching wigl-widgets/ source)`);
    }
  }
};

/** Loads *and renders* a built widget in a plain bun process, against the
 * host's real modules — the same React object the app would hand it.
 *
 * Rendering is the point, not a bonus. A webview's console is invisible to
 * `bun run verify` (see docs/debugging.md), so "the app launched cleanly"
 * says nothing about whether a widget worked; and an earlier version of this
 * check that only imported the bundle against stub modules passed happily
 * while the widget crashed on its first render with "dispatcher.getOwner is
 * not a function" — a bundled copy of React's dev jsx runtime meeting the
 * host's React. Anything that doesn't actually render can't catch that whole
 * class of bug, which is the main risk this boundary carries.
 *
 * This is `renderToString`, not real SSR — wigl has no server, this is a
 * headless correctness probe borrowing React's server renderer because it's
 * the cheapest way to force a first render outside a browser/webview.
 * `useEffect` never fires under it, so a widget's actual `setInterval`/shell-
 * command/`useStorage` data-fetch path is never exercised here — only
 * import-time crashes, jsx-runtime mismatches, an undeclared host module, and
 * a first-render throw. That gap is fine to leave open (see docs/debugging.md
 * for how a widget's live behavior actually gets verified) rather than
 * pulling in a DOM shim to close it. */
const check = async (dir: string) => {
  requireProductionEnv("check");
  const config = await readWidgetConfig(dir);
  const entry = join(dir, config.entry);
  if (!(await Bun.file(entry).exists())) die(`${config.id}: not built yet — run widget:build first`);

  // Real host modules, resolved through the app's own tsconfig paths — a
  // stub would defeat the purpose. `@tauri-apps/*` calls inside them do fail
  // outside a webview, but `renderToString` runs no effects, so a widget's
  // first paint doesn't depend on one.
  const real = new Map<string, unknown>();
  for (const spec of HOST_MODULE_IDS) {
    try {
      real.set(spec, await import(spec));
    } catch (e) {
      die(`host module "${spec}" can't be imported for checking: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const required: string[] = [];
  const g = globalThis as unknown as { __wigl_scopes__: Record<string, (s: string) => unknown> };
  g.__wigl_scopes__ = {
    [config.id]: (spec: string) => {
      const mod = real.get(spec);
      if (!mod) die(`${config.id}: required "${spec}", which the host doesn't serve`);
      required.push(spec);
      return mod;
    },
  };

  const header = `const __wigl_host = { require: globalThis.__wigl_scopes__[${JSON.stringify(config.id)}] };\n`;
  // Via a temp file rather than the app's blob URL: bun can't import a data:
  // URL this large, and it has no `URL.createObjectURL`. The bundle is
  // byte-identical either way — only the module's origin differs.
  const tmp = join(tmpdir(), `wigl-check-${config.id}-${Date.now()}.mjs`);
  await Bun.write(tmp, header + (await Bun.file(entry).text()));
  let mod: { default?: unknown };
  try {
    // Bun's dynamic import() can't resolve an absolute path when the
    // process cwd sits inside the same symlinked tmpdir tree (macOS aliases
    // /var/folders -> /private/var/folders) — realpath collapses both sides
    // onto the same canonical path so resolution isn't fooled by the alias.
    mod = (await import(await realpath(tmp))) as { default?: unknown };
  } finally {
    await rm(tmp, { force: true });
  }
  if (typeof mod.default !== "function") die(`${config.id}: entry has no default-exported component`);

  const { createElement } = await import("react");
  const { renderToString } = await import("react-dom/server");
  let html: string;
  try {
    html = renderToString(createElement(mod.default as () => null));
  } catch (e) {
    die(`${config.id}: crashed on render — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!(html as string).trim()) die(`${config.id}: rendered nothing`);
  if (!(html as string).includes("data-wigl-widget")) {
    die(`${config.id}: default export doesn't render <Widget> — wrap the root in <Widget> from "@/wigl"`);
  }

  const unique = [...new Set(required)].sort();
  console.log(`✓ ${config.id} loads and renders (${(html as string).length} chars of markup)`);
  console.log(`  host modules: ${unique.join(", ") || "none"}`);
  console.log(`  permissions declared: ${config.permissions.join(", ") || "none"}`);
};

/** Exports what an out-of-repo widget folder needs to typecheck the same way
 * `wigl-widgets/` does: a fresh `types/` (regenerated, since a stale one
 * would silently typecheck against an outdated host API) plus the tsconfig
 * that points `@/*` at it. Copy destination becomes a drop-in root — put
 * widget folders directly under it and `tsc -p <dest> --noEmit` typechecks
 * them exactly like `bun run typecheck:widgets` does in-repo. This is the
 * actual mechanism the e2e suite exercises (tests/e2e/README.md) — not a
 * test-only shim, since a widget author working outside this repo needs the
 * same export to typecheck against at all (see docs/widgets.md). */
const devkit = async (dest: string) => {
  const destResolved = resolve(dest);
  await mkdir(destResolved, { recursive: true });
  console.log("regenerating widget types (bun run widget:types)...");
  // cwd: repoRoot, not inherited — `bun run widget:types` needs package.json
  // underfoot, which is only guaranteed at the repo root, not wherever this
  // process itself happened to be launched from.
  const proc = Bun.spawn(["bun", "run", "widget:types"], { cwd: repoRoot, stdio: ["inherit", "inherit", "inherit"] });
  if ((await proc.exited) !== 0) die("widget:types failed — fix the host API typecheck before exporting a devkit");

  await cp(join(repoRoot, "wigl-widgets/tsconfig.json"), join(destResolved, "tsconfig.json"));
  await rm(join(destResolved, "types"), { recursive: true, force: true });
  await cp(join(repoRoot, "wigl-widgets/types"), join(destResolved, "types"), { recursive: true });

  // `wigl-widgets/tsconfig.json` resolves bare "react"/"react/jsx-runtime"
  // (every generated .d.ts under types/ that touches a component prop needs
  // it, and the `jsx: "react-jsx"` compiler option needs it for every .tsx
  // file) by walking up from its own location through ancestor node_modules
  // — which finds this repo's `@types/react` for free only because
  // wigl-widgets/ lives inside the repo. Moved anywhere else, that walk hits
  // nothing and every widget fails to typecheck with "This JSX tag requires
  // the module path 'react/jsx-runtime' to exist" even though the widget
  // itself has no error — a real bug this e2e suite (tests/e2e/) caught.
  // Vendoring the exact same `@types/react` (+ its one dependency,
  // `csstype`) this repo is pinned to fixes it without asking a widget
  // author to separately `bun install` anything, and guarantees the types
  // are the same version the host actually serves at runtime.
  for (const pkg of [join("@types", "react"), "csstype"]) {
    const src = join(repoRoot, "node_modules", pkg);
    if (await Bun.file(join(src, "package.json")).exists()) {
      await rm(join(destResolved, "node_modules", pkg), { recursive: true, force: true });
      await cp(src, join(destResolved, "node_modules", pkg), { recursive: true });
    }
  }
  console.log(`✓ devkit exported to ${destResolved} (tsconfig.json + types/ + react type deps)`);
  console.log(`  typecheck widgets placed there with: tsc -p ${destResolved} --noEmit`);
};

const list = async () => {
  const root = installRoot();
  let entries: string[] = [];
  try {
    entries = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    console.log(`no widgets installed (${root} doesn't exist yet)`);
    return;
  }
  if (!entries.length) return console.log(`no widgets installed (${root})`);
  for (const id of entries) {
    try {
      const pkgFile = Bun.file(join(root, id, "package.json"));
      const raw = (await pkgFile.exists()) ? await pkgFile.text() : null;
      const { permissions } = resolvePluginConfig(id, raw);
      console.log(`${id.padEnd(16)} permissions: ${permissions.join(", ") || "none"}`);
    } catch {
      console.log(`${id.padEnd(16)} (unreadable package.json)`);
    }
  }
};

const remove = async (id: string) => {
  const target = join(installRoot(), id);
  if (!(await stat(target).catch(() => null))) die(`${id} is not installed`);
  await rm(target, { recursive: true, force: true });
  console.log(`✓ removed ${id}`);
};

/** Installs a widget straight from a git URL — clone into a temp dir named
 * after the target id (so `install()`'s own `basename(dir)` id derivation
 * needs no separate override path), build it if it ships TS source, install
 * it, then throw the clone away. Never touches `wigl-widgets/` — this is
 * "get it running," not "vendor the source into this repo." Only runs under
 * `bun`, same as every other command here (see COMMANDS' own comment on why
 * the Settings modal's Widgets section can't call into this instead). */
const add = async (url: string, idArg?: string) => {
  const id = idArg || basename(url).replace(/\.git$/, "");
  if (!id) die(`could not derive a widget id from "${url}" — pass one explicitly: widget add <url> <id>`);
  if (RESERVED_PLUGIN_IDS.has(id)) die(`"${id}" is a reserved id`);

  const tmpRoot = await mkdtemp(join(tmpdir(), "wigl-widget-add-"));
  const cloneDir = join(tmpRoot, id);
  try {
    console.log(`cloning ${url}...`);
    const clone = Bun.spawn(["git", "clone", "--depth", "1", url, cloneDir], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    if ((await clone.exited) !== 0) die(`git clone failed for "${url}"`);
    await install(cloneDir);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
};

/** One entry per CLI verb — what used to be a hand-written `switch` case,
 * now a lookup table so the set of commands is introspectable instead of
 * only living inside the switch's control flow. `label` is for a future
 * consumer that wants a human name (there isn't one yet — see the note
 * below); `run` is exactly the old case body, unchanged.
 *
 * The Settings modal's Widgets section (`src/wigl/settings/sections/
 * widgets.tsx`) does NOT import this table: this file uses `node:fs/promises`,
 * `node:os`, and `Bun.build`, none of which exist in a webview, so it can
 * never be bundled into the running app — only run under `bun`. That section
 * re-implements `list`/`rm` itself instead, shelling out against
 * `pluginsDir()` the same way `src/wigl/plugins/loader.ts` already does
 * (see that file's own comment for why `sh` over a Tauri fs plugin). This
 * table's payoff is CLI-side only: one place that enumerates every verb,
 * instead of a switch statement being the only source of truth for what
 * commands exist. */
interface CliCommand {
  id: string;
  label: string;
  usage: string;
  run: (arg?: string, extra?: string) => Promise<void>;
}

const COMMANDS: CliCommand[] = [
  {
    id: "build",
    label: "Build",
    usage: "widget build [dir]",
    run: async (arg) => {
      if (arg) {
        await build(resolve(arg));
      } else {
        for (const dir of await allWidgetDirs()) {
          if (findEntrySource(dir)) await build(dir);
          else console.log(`- ${basename(dir)}: no index.tsx/ts, skipped (ships pre-built JS)`);
        }
      }
    },
  },
  {
    id: "install",
    label: "Install",
    usage: "widget install [dir]",
    run: async (arg) => {
      if (arg) {
        await install(resolve(arg));
      } else {
        const dirs = await allWidgetDirs();
        for (const dir of dirs) await install(dir);
        await pruneStaleInstalls(new Set(dirs.map((d) => basename(d))));
      }
    },
  },
  {
    id: "check",
    label: "Check",
    usage: "widget check <dir>",
    run: async (arg) => {
      await check(resolve(arg ?? die("usage: widget check <dir>")));
    },
  },
  {
    id: "list",
    label: "List installed",
    usage: "widget list",
    run: async () => {
      await list();
    },
  },
  {
    id: "rm",
    label: "Remove",
    usage: "widget rm <id>",
    run: async (arg) => {
      await remove(arg ?? die("usage: widget rm <id>"));
    },
  },
  {
    id: "devkit",
    label: "Export devkit",
    usage: "widget devkit <dest-dir>",
    run: async (arg) => {
      await devkit(arg ?? die("usage: widget devkit <dest-dir>"));
    },
  },
  {
    id: "add",
    label: "Add from git URL",
    usage: "widget add <git-url> [id]",
    run: async (arg, extra) => {
      requireProductionEnv("add");
      await add(arg ?? die("usage: widget add <git-url> [id]"), extra);
    },
  },
];

const [cmd, arg, extra] = process.argv.slice(2);
const command = COMMANDS.find((c) => c.id === cmd);
if (!command) die(`usage: widget <${COMMANDS.map((c) => c.id).join("|")}> [dir|id]`);
await command.run(arg, extra);
