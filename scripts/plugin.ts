#!/usr/bin/env bun
/**
 * Plugin CLI — build / install / list / rm.
 *
 *   bun run plugin:build       wigl-widgets/calendar   # one widget
 *   bun run plugin:build                               # every wigl-widgets/<name> folder
 *   bun run plugin:install     wigl-widgets/calendar   # build, then copy into app data
 *   bun run plugin:install                             # build+install every widget
 *   bun run plugin:list
 *   bun run plugin:rm          calendar
 *
 * Why a build step exists at all: a webview has no compiler, so it cannot
 * import a `.tsx` file. Shipping one in the app (esbuild-wasm and friends)
 * would add ~9MB to a desktop-widget app to save plugin authors a command.
 * `Bun.build` does it here instead — no new dependency, since the repo
 * already requires bun. A plugin that ships hand-written, already-built JS
 * (no TypeScript, no `wigl` build tooling at all) skips this step entirely —
 * `plugin:install` only builds when there's an `index.tsx`/`index.ts` to
 * build, otherwise it installs whatever's already sitting at the resolved
 * entry path.
 *
 * The important part isn't the bundling, it's the externals: every specifier
 * in HOST_MODULE_IDS is rewritten to a `__wigl_host.require(...)` call the
 * host answers at load time (see `src/wigl/plugins/loader.ts`). That's what
 * keeps exactly one React in the process, and it's what makes permissions
 * enforceable rather than decorative.
 */
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { HOST_MODULE_IDS } from "../src/wigl/plugins/host-modules";
import { RESERVED_PLUGIN_IDS, resolvePluginConfig } from "../src/wigl/plugins/types";

const WIDGETS_ROOT = "wigl-widgets";
const NON_PLUGIN_DIRS = new Set(["types"]);
// A leading "_" opts a wigl-widgets/ folder out of discovery/build entirely —
// e.g. `_qa-color`, a dev-only QA surface with no reason to ship.

// Mirrors Tauri's `appDataDir()` for this app's identifier. Kept in sync
// with `src/config/app.ts` by reading the same source of truth Tauri does.
const identifier = (await Bun.file("src-tauri/tauri.conf.json").json()).identifier as string;
const appDataDir = () =>
  process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", identifier)
    : join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), identifier);
const installRoot = () => join(appDataDir(), "plugins");

const die = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

/** Bun picks the JSX transform (`jsx` vs `jsxDEV`) and resolves React's
 * dev-vs-production build from NODE_ENV *at process start* — no build option
 * or later assignment overrides it. The app ships production React, and the
 * two are not interchangeable: a `jsxDEV` call into a production React is
 * exactly the "dispatcher.getOwner is not a function" crash this cost once
 * already. So building or checking under the wrong NODE_ENV is refused
 * outright rather than producing a bundle that looks fine and isn't. The
 * `plugin:*` package scripts set it; this is the guard for anyone invoking
 * the script directly. */
const requireProductionEnv = (what: string) => {
  if (process.env.NODE_ENV !== "production") {
    die(`${what} must run with NODE_ENV=production (use \`bun run plugin:${what}\`, which sets it)`);
  }
};

/** No manifest.json: id is the folder name, entry/permissions come from an
 * optional package.json (`resolvePluginConfig` in types.ts — the same
 * resolution the runtime loader uses). No package.json at all is valid: a
 * zero-config plugin defaults to `.wigl/index.js`, no permissions. */
const readPluginConfig = async (dir: string) => {
  const id = basename(dir);
  if (RESERVED_PLUGIN_IDS.has(id)) die(`"${id}" is a reserved id`);
  const pkgFile = Bun.file(join(dir, "package.json"));
  const raw = (await pkgFile.exists()) ? await pkgFile.text() : null;
  return { ...resolvePluginConfig(id, raw), pkgRaw: raw };
};

const findEntrySource = (dir: string) =>
  ["index.tsx", "index.ts"].map((f) => join(dir, f)).find((p) => Bun.file(p).size >= 0);

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
  const config = await readPluginConfig(dir);
  const entrySrc = findEntrySource(dir);
  if (!entrySrc) {
    die(`${dir}: no index.tsx or index.ts to build (ships hand-written JS? skip plugin:build, go straight to plugin:install)`);
  }

  const outPath = join(dir, config.entry);
  const outdir = dirname(outPath);
  await rm(outdir, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: [entrySrc as string],
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
      `${config.id}: build didn't produce "${config.entry}" — if package.json sets a custom "main", leave it as the default ".wigl/index.js" while using plugin:build`,
    );
  }
  const size = (await stat(outPath)).size;
  console.log(`✓ built ${config.id} → ${config.entry} (${(size / 1024).toFixed(1)}kb)`);
  return config;
};

const install = async (dir: string) => {
  const config = await readPluginConfig(dir);
  const built = findEntrySource(dir) ? await build(dir) : config;
  const entryPath = join(dir, built.entry);
  if (!(await Bun.file(entryPath).exists())) {
    die(`${dir}: no index.tsx/ts and no built entry at "${built.entry}" — nothing to install`);
  }

  const target = join(installRoot(), built.id);
  // Only package.json and the entry file are installed — the plugin's other
  // source, node_modules and tsconfig are build-time concerns with no
  // business sitting in a user's app-data dir.
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(join(target, built.entry)), { recursive: true });
  if (built.pkgRaw) await Bun.write(join(target, "package.json"), built.pkgRaw);
  await Bun.write(join(target, built.entry), Bun.file(entryPath));
  console.log(`✓ installed ${built.id} → ${target}`);
  console.log("  restart wigl (bun run verify) to see it.");
};

/** Every `wigl-widgets/<name>` folder, in the same order `ls` would give —
 * used when `build`/`install` are called with no dir so "do it to every
 * widget" is one command instead of one per folder. */
const allPluginDirs = async (): Promise<string[]> => {
  const entries = await readdir(WIDGETS_ROOT, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !NON_PLUGIN_DIRS.has(e.name) && !e.name.startsWith("_"))
    .map((e) => resolve(WIDGETS_ROOT, e.name));
};

/** Loads *and renders* a built plugin in a plain bun process, against the
 * host's real modules — the same React object the app would hand it.
 *
 * Rendering is the point, not a bonus. A webview's console is invisible to
 * `bun run verify` (see docs/debugging.md), so "the app launched cleanly"
 * says nothing about whether a plugin worked; and an earlier version of this
 * check that only imported the bundle against stub modules passed happily
 * while the plugin crashed on its first render with "dispatcher.getOwner is
 * not a function" — a bundled copy of React's dev jsx runtime meeting the
 * host's React. Anything that doesn't actually render can't catch that whole
 * class of bug, which is the main risk this boundary carries. */
const check = async (dir: string) => {
  requireProductionEnv("check");
  const config = await readPluginConfig(dir);
  const entry = join(dir, config.entry);
  if (!(await Bun.file(entry).exists())) die(`${config.id}: not built yet — run plugin:build first`);

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
    mod = (await import(tmp)) as { default?: unknown };
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

const list = async () => {
  const root = installRoot();
  let entries: string[] = [];
  try {
    entries = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    console.log(`no plugins installed (${root} doesn't exist yet)`);
    return;
  }
  if (!entries.length) return console.log(`no plugins installed (${root})`);
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

const [cmd, arg] = process.argv.slice(2);
switch (cmd) {
  case "build":
    if (arg) {
      await build(resolve(arg));
    } else {
      for (const dir of await allPluginDirs()) {
        if (findEntrySource(dir)) await build(dir);
        else console.log(`- ${basename(dir)}: no index.tsx/ts, skipped (ships pre-built JS)`);
      }
    }
    break;
  case "install":
    if (arg) {
      await install(resolve(arg));
    } else {
      for (const dir of await allPluginDirs()) await install(dir);
    }
    break;
  case "check":
    await check(resolve(arg ?? die("usage: plugin check <dir>")));
    break;
  case "list":
    await list();
    break;
  case "rm":
    await remove(arg ?? die("usage: plugin rm <id>"));
    break;
  default:
    die("usage: plugin <build|check|install|list|rm> [dir|id]");
}
