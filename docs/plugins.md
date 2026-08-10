# Plugins

A plugin is a widget: its own folder, its own build, installed into the
user's app-data dir, loaded at startup. Every widget is a plugin — adding one
doesn't require rebuilding wigl, which is the whole point (an earlier
`src/widgets/` path, compiled into the app, made every widget author a
person who could compile the app; it's gone now that the last folder there
migrated out — see `docs/widgets.md`).

This file owns the plugin contract. The mechanism lives in
`src/wigl/plugins/` (host side) and `scripts/plugin.ts` (build/install CLI) —
read those for the "how, in action".

## The folder

```
wigl-widgets/calendar/
├── package.json       # optional — deps, and wigl-specific config (below)
├── index.tsx          # source entry
├── Sidebar.tsx        # whatever else it wants
└── .wigl/index.js     # built output — dot-prefixed, out of sight by default
```

**No manifest.json, and no required config file at all.** A plugin's id is
always its folder name — already required to be unique, so a second field
hand-typed to match it would only be one more thing to keep in sync (and one
more way for a typo to go unnoticed). A folder with just `index.tsx` and
nothing else is a complete, valid, zero-config plugin.

A folder name starting with `_` (e.g. `_qa-color`) is skipped by the no-arg
"every widget" form of `plugin:build`/`plugin:install`. Use this for dev-only
QA surfaces that have no reason to ship; it's still buildable and installable
by name (`bun run plugin:install wigl-widgets/_qa-color`), it just doesn't
get swept in automatically.

Build output lives under `.wigl/`, not a plain `dist/` — dot-prefixed
folders are the convention this ecosystem already uses for "generated, not
source" (`.next/`, `.svelte-kit/`, `.turbo/`), and it means a widget author
who never touches the build step sees only their own source files when they
open the folder, not the machinery. `node_modules/` stays exactly where
`bun install` naturally puts it (sibling to `package.json`) rather than
tucked away too — it's the one file every JS-literate author already expects
there, and relocating it would need a non-standard bun linker config for a
purely cosmetic win.

`package.json` is optional and does triple duty when a plugin needs it:

- **npm dependencies** — ordinary `dependencies`, bundled into *that*
  plugin's own build (see "Building and installing" below). This is the only
  thing `package.json` was for until now.
- **`main`** — overrides the entry path, same field Node already uses for
  "here's the entry point." Defaults to `.wigl/index.js`. Set this to a
  hand-written, already-built JS file (and skip `plugin:build` entirely) if a
  plugin doesn't want the TypeScript/JSX toolchain at all — the host just
  loads whatever's there, same as it loads a `plugin:build` output. It must
  still be a single self-contained ES module: the loader evaluates it from a
  blob URL with no file-relative resolution, so hand-written multi-file
  plugins need their own bundling step before `main` can point at the result.
- **`wigl.permissions`** — the one thing that isn't a standard `package.json`
  field, namespaced under a `wigl` key the same way other tools use
  `eslintConfig`/`browserslist`/`lint-staged` rather than inventing a
  separate config file. See "Permissions" below.

`resolvePluginConfig` (`src/wigl/plugins/types.ts`) is the single place that
turns a folder name + optional `package.json` text into `{ id, entry,
permissions }` — both the runtime loader and `scripts/plugin.ts` call it, so
"what does a missing/partial `package.json` mean" is defined exactly once.

## The host module registry — the actual boundary

A plugin's bundle contains its own code and its own npm dependencies, and
*nothing else*. Every specifier in `src/wigl/plugins/host-modules.ts` —
`react`, `@/wigl`, `@/wigl/hooks`, `@/wigl/utils`, the shadcn UI components,
`lucide-react` — is rewritten by the build into a call the host answers at
load time.

Two things fall out of that, and both are the reason it exists:

1. **There is exactly one React in the process.** A plugin that bundled its
   own copy would get its own hook dispatcher and break the moment it rendered
   inside the host's tree — a failure that presents as nonsense rather than
   as an error.
2. **It's the only place a capability can be handed out, so it's the only
   place one can be withheld.** Permissions aren't a separate subsystem to
   build later; they're a lookup in that table.

`@tauri-apps/*` is deliberately not on the list. A plugin holding a raw IPC
handle could re-implement every capability permissions are supposed to gate,
which would make the whole permission model decorative. When a plugin needs
something no host module covers, the answer is a new host module — not an
escape hatch.

## Permissions

`package.json`'s `wigl.permissions` declares what the plugin may use;
`src/wigl/plugins/registry.ts` enforces it when resolving a host module.
Enforcement is per-module *and* per-export, because `@/wigl/utils` hands out
both `cn` (string formatting) and `runCmd` (arbitrary shell) — gating it as a
unit would force every plugin that wants to merge class names to also ask for
shell access. A withheld export is replaced by a thrower that names the
missing permission, rather than omitted, so the failure points at the call
site.

**What this is not**: a sandbox, and — worth being honest about — not much of
a security boundary at all once a plugin has *any* of `command`/`filesystem`
permission. A plugin's code runs in the same JS realm as the host with
`csp: null` (`window.__TAURI_INTERNALS__` is reachable by anything determined
to reach it), and `command` means arbitrary shell, which is already more
access than the permission list's other entries are worth gating once
granted. What the list still buys, even under that honest framing: it's a
lookup table, not a separate subsystem, so it costs nothing to keep; it makes
which capabilities a plugin *claims* to need legible at a glance
(`plugin:list`/`plugin:check` both print it) instead of buried in source; and
it still catches the *accidental* case — a plugin that doesn't need shell
access can't reach `runCmd` by mistake, which is the more common failure mode
than a deliberately hostile plugin. Treat an installed plugin as code you
chose to trust, the same as a VS Code extension or a browser extension with
broad host permissions — not as something sandboxed from the app that
installed it. See `backlog.md`.

## Building and installing

```
bun run plugin:build   wigl-widgets/calendar   # source → .wigl/index.js
bun run plugin:check   wigl-widgets/calendar   # load it headlessly, report host modules used
bun run plugin:install wigl-widgets/calendar   # build (if there's source), then copy into app data
bun run plugin:build                           # no dir: every wigl-widgets/<name> folder that has source
bun run plugin:install                         # no dir: every wigl-widgets/<name> folder
bun run plugin:list
bun run plugin:rm      calendar
```

**Renaming or deleting a `wigl-widgets/<name>` folder does not remove its old
installed copy.** `plugin:install` (with or without a dir argument) only
ever adds/updates whatever source folders currently exist — it never looks
at what's already sitting in the app-data plugins dir, so an id that no
longer has a matching source folder is simply never touched again and keeps
loading forever (verified live: renaming `qa-colors` → `_qa-color` left the
app still rendering the old `qa-colors` install until it was removed by
hand). Run `bun run plugin:rm <old-id>` yourself as part of any rename or
deletion — `plugin:install` deliberately doesn't auto-prune orphaned ids,
since the plugin system is meant to support installs with no corresponding
`wigl-widgets/` source at all (a hand-copied local plugin folder is a valid
install; a URL/registry-based install is still rejected — see
`docs/future-ideas.md`'s intro), so "installed but no longer in source"
isn't reliably a mistake the tooling can tell apart from an intentional one.

Installed plugins live next to `wigl.db` in the per-OS app-data dir, one
folder per plugin id. Only `package.json` (if present) and the entry file are
installed — other source, `node_modules` and tsconfig are build-time concerns
with no business in a user's data dir.

**Each plugin gets its own `.wigl/index.js`, on purpose — not one shared
bundle.** That's what keeps a plugin's own npm dependencies (calendar's
`date-fns`, or a hypothetical stock-ticker widget's charting library) out of
the core app: `bun run plugin:build` runs esbuild once per plugin folder,
bundling *that* plugin's own `node_modules` into *that* plugin's own output,
with only the host modules externalized (see above) — meaning React, `@/wigl`
and every other host module are *not* duplicated per plugin; only a plugin's
*own* third-party dependencies are, and only if another plugin happens to
need the same one, which so far only calendar does. A single combined bundle
would mean either bundling every plugin's dependencies into one file the core
ships (exactly what this design avoids) or reinventing a second build system
to keep them apart — more moving parts for the same result. If per-plugin
duplication of a *shared* third-party library ever becomes a measured
problem (not before), the fix shape is an opt-in host module for that
specific library, same as `react`/`lucide-react` already are — not a shared
build. Calling `plugin:build`/`plugin:install` with no dir argument builds
or installs every widget folder in one pass; that's the whole gap a heavier
tool (a Turborepo-style workspace) would have closed, and it doesn't need
one. `bun run qa`/`bun run verify` already call `plugin:install` with no
argument before launching, so a freshly-added or freshly-edited widget shows
up without a separate install step.

`plugin:check` matters more than it looks: a webview's console is invisible
to `bun run verify` (see `docs/debugging.md`), so "the app launched cleanly"
says nothing about whether a plugin actually worked. `check` loads the built
bundle in a plain bun process against the host's **real** modules and
**renders it** with `renderToString`. It also prints which host modules the
bundle really pulls in.

Both the rendering and the realness are load-bearing, and both are scar
tissue: a first version of this check imported the bundle against stub
modules, never rendered, and passed cleanly on a plugin that crashed on its
first paint in the real app with `dispatcher.getOwner is not a function`.
Anything that doesn't render can't see that class of bug at all.

The rendered markup is also how `plugin:check` enforces the export contract:
a default export is required to render a `<Widget>` as its root (`docs/widgets.md`),
not just any component, so `check` fails the build if the rendered HTML is
missing `<Widget>`'s `data-wigl-widget` marker attribute — catching a widget
that forgot to wrap itself, which would otherwise silently never report a
grid size instead of erroring. This is enforced at the build boundary only —
nothing inside `src/wigl/widget.tsx` checks it at runtime (e.g. `WidgetHeader`
doesn't verify it's inside a `Widget`); a widget author misusing the API past
what `plugin:check` catches is their own call to get wrong, not something
worth extra runtime ceremony to prevent.

## CSS

A plugin can `import "./whatever.css"` from its own source (not through a
host module — those are externalized, see above) and it works: `Bun.build`'s
built-in CSS loader bundles every such import into one sibling asset next to
the entry point (`index.js` → `index.css`, verified against a live build —
no `naming`/loader config needed), `plugin:install` copies that sibling
alongside `index.js` the same way it already copies `package.json`, and
`loadPlugins()` (`src/wigl/plugins/loader.ts`) reads it as text (same `sh -c
cat` path as the JS) and injects it as a `<style>` tag — keyed and de-duped
by plugin id so a second load/monitor-realm never doubles it up. `.textContent`,
not `dangerouslySetInnerHTML`: the CSS is build-time plugin source, not
runtime/user content, so the hard rule against unescaped HTML doesn't apply
to it.

This closed what used to be a real gap — an editor library that ships a
required stylesheet (Milkdown/Crepe was the concrete case, see
`wigl-widgets/LocalCode/AGENTS.md`) had nothing to load its CSS through,
since the loader only ever evaluated one JS blob. A widget still owes itself
the same theming discipline as everywhere else — `docs/theming.md`'s
semantic-token rule doesn't stop applying just because real CSS is now
possible — but the *mechanism* is no longer the blocker.

## NODE_ENV is part of the contract

`plugin:build` and `plugin:check` refuse to run unless `NODE_ENV=production`
(the `plugin:*` package scripts set it; the guard is for direct invocation).

This isn't hygiene, it's correctness. Bun picks the JSX transform (`jsx` vs
`jsxDEV`) and resolves React's dev-vs-production build from `NODE_ENV` *at
process start* — no `Bun.build` option and no later assignment overrides it.
The app ships production React, and a bundle transpiled to `jsxDEV` calls
into React internals that build doesn't have. That's the crash above, and it
is invisible in every check that doesn't render against production React
specifically — including a check that renders against a *development* React,
where the same broken bundle works fine.

`react/jsx-dev-runtime` is on the host module list alongside
`react/jsx-runtime` for the same reason: externalizing only the production
one looks right and silently isn't.

## Typechecking

`wigl-widgets/tsconfig.json` is the plugin-side tsconfig, and it resolves
`@/...` to generated `.d.ts` under `wigl-widgets/types/` (`bun run
plugin:types`), never to `../src`. That's what stops "it compiles" from
depending on the plugin happening to share a repo with the app.

Types are deliberately broader than the runtime API: `@/*` resolves at the
type level, but only the specifiers in `host-modules.ts` are externalized by
the build. A deep import like `@/wigl/Desktop` therefore fails at
`plugin:build` with a resolution error, rather than silently bundling a
second copy of a host component — and, for anything React-shaped, a second
React.

## Loading

`loadPlugins()` (`src/wigl/plugins/loader.ts`) reads each folder's optional
`package.json` and built entry as text through `sh` — the same "shell out, no
new Rust" rule the storage layer follows — prepends a per-plugin header
binding the scoped `require`, and imports the result as a blob URL. Reading
through `sh` rather than serving files over Tauri's asset protocol is what
keeps this a zero-config addition: no capability, `tauri.conf.json`, or Rust
change is needed to install a plugin.

Discovery never throws. A plugin that fails to load comes back as a failure
the app renders on screen, because the alternative — one bad plugin blanking
every widget on the desktop — is exactly what this app's error boundaries
exist to prevent.

`src/App.tsx` holds `<Desktop>` back until discovery settles. That's
deliberate: `<Desktop>` builds its layout from the widget ids it's handed,
and handing it a set that grows a tick later is the same mount-order hazard
that already cost a first-launch layout bug once.

## Building a new plugin

`wigl-widgets/calendar/` is the worked example — copy its shape, not just
its idea. Steps, in order:

1. Create `wigl-widgets/<name>/index.tsx` (the component contract is
   `docs/widgets.md`'s). Nothing else is required.
2. If the widget needs npm dependencies (calendar has `date-fns`) or
   permissions (`storage` if it touches `useStorage`/`useQuery`; see the
   registry section above for the full list), add
   `wigl-widgets/<name>/package.json`:
   ```json
   {
     "dependencies": { "date-fns": "^4.4.0" },
     "wigl": { "permissions": ["storage"] }
   }
   ```
   Then `bun install` at the repo root so dependencies resolve for the build.
3. `bun run plugin:build wigl-widgets/<name>` — read the error if it fails.
   The two failure modes so far are both host-module gaps: an import not in
   `src/wigl/plugins/host-modules.ts` (add it there and to
   `registry.ts`'s `HOST_MODULES`, gated by permission if it's a capability
   rather than a pure helper), or a deep import past the three shared
   barrels (`@/wigl/Desktop`, `@/wigl/grid/...`) — those are supposed to fail;
   fix the widget's import instead of the registry.
4. `bun run plugin:check wigl-widgets/<name>` — this must pass before
   `typecheck:plugins`, i.e. before touching anything else. It's the only
   step that proves the widget actually renders against the app's real,
   production React, and that its default export actually wraps a
   `<Widget>`; see "NODE_ENV is part of the contract" above for why a green
   `typecheck` here is not sufficient on its own.
5. `bun run typecheck:plugins` — proves the widget compiles against the
   plugin tsconfig (`wigl-widgets/tsconfig.json`, generated `.d.ts`) rather
   than the app's live source. A widget that only compiled by accident
   (deep-importing something the app's root tsconfig happened to resolve)
   fails here even though step 3/4 already passed, because the build step
   externalizes by specifier while this step type-resolves by path — catching
   one doesn't guarantee the other, run both.
6. `bun run plugin:install wigl-widgets/<name>` then `bun run verify` —
   confirm it's on screen.

A widget that imports `@tauri-apps/api/path` or `@tauri-apps/plugin-shell`
directly (raw Tauri APIs — plugins can't hold one, see "The host module
registry" above) needs the underlying capability turned into a mediated host
module first, not an escape hatch around the registry. `@/wigl/utils`'s
`homeDir` (gated on `filesystem`) and `runCmdStreaming` (gated on
`command`, the streaming counterpart to `runCmd`) are two such modules,
added when the `repos` widget migrated to a plugin — copy that shape for the
next gap rather than inventing a new one. A widget that locates a bundled
non-code resource via `resolveResource` (Tauri's app-resource resolution) has
no plugin equivalent at all — installed plugins ship only `package.json` and
the entry file (see "Building and installing" above), so the fix is to stop
needing the resource, not to find a way to ship it. `repos`' old scan script
was a `bun`-run `.ts` file resolved this way; it's now a POSIX `sh` script
(`wigl-widgets/repos/scan.ts`) run through `runCmd`, which needs nothing
beyond what every other shell-out in this app already needs.
