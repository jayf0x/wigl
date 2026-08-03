# Plugins

A plugin is a widget that lives outside the app: its own folder, its own
build, installed into the user's app-data dir, loaded at startup. Adding one
doesn't require rebuilding wigl, which is the whole point — the builtin
`src/widgets/` path (see `docs/widgets.md`) makes every widget author a
person who can compile the app, and that's not a usable distribution story.

This file owns the plugin contract. The mechanism lives in
`src/wigl/plugins/` (host side) and `scripts/plugin.ts` (build/install CLI) —
read those for the "how, in action".

## The folder

```
wigl-widgets/calendar/
├── manifest.json      # required — the only file the host reads first
├── package.json       # optional — the plugin's own npm dependencies
├── index.tsx          # source entry
├── Sidebar.tsx        # whatever else it wants
└── dist/index.js      # built output; what the manifest's `entry` points at
```

`manifest.json`, not `package.json`, is the contract file. `package.json`
implies npm semantics — a dependency list something installs for you — and a
plugin's dependencies are bundled at build time, never resolved at runtime.
Different contract deserves a different filename. A plugin may *also* have a
`package.json` for its own build-time deps; the host never reads it.

The manifest's fields are defined in `src/wigl/plugins/types.ts`. Two are
worth calling out here because they're contract, not implementation:

- **`entry` points at built JavaScript, not at the `.tsx` source.** A webview
  has no compiler. Shipping one (esbuild-wasm and friends) would add
  megabytes to a desktop-widget app to save plugin authors one command, so
  the build happens on the author's machine instead.
- **`apiVersion`** is the host runtime's contract version. A mismatch fails
  the load loudly rather than half-working against an API that moved.

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
handle could re-implement every capability the manifest is supposed to gate,
which would make the whole permission model decorative. When a plugin needs
something no host module covers, the answer is a new host module — not an
escape hatch.

## Permissions

`manifest.json` declares what the plugin may use; `src/wigl/plugins/registry.ts`
enforces it when resolving a host module. Enforcement is per-module *and*
per-export, because `@/wigl/utils` hands out both `cn` (string formatting)
and `runCmd` (arbitrary shell) — gating it as a unit would force every
plugin that wants to merge class names to also ask for shell access. A
withheld export is replaced by a thrower that names the missing permission,
rather than omitted, so the failure points at the call site.

**What this is not**: a sandbox. A plugin's code runs in the same JS realm as
the host with `csp: null`, so `window.__TAURI_INTERNALS__` is reachable by
anything determined to reach it. The registry raises the floor — it makes the
honest path the easy one and makes capability use visible in a manifest —
but real isolation needs a per-plugin worker/iframe or Tauri's isolation
pattern. Treat an installed plugin as code you chose to trust, the same as a
VS Code extension. See `backlog.md`.

## Building and installing

```
bun run plugin:build   wigl-widgets/calendar   # source → dist/index.js
bun run plugin:check   wigl-widgets/calendar   # load it headlessly, report host modules used
bun run plugin:install wigl-widgets/calendar   # build, then copy into app data
bun run plugin:list
bun run plugin:rm      calendar
```

Installed plugins live next to `wigl.db` in the per-OS app-data dir, one
folder per plugin id. Only `manifest.json` and `dist/` are installed —
source, `node_modules` and tsconfig are build-time concerns with no business
in a user's data dir.

`plugin:check` matters more than it looks: a webview's console is invisible
to `bun run verify` (see `docs/debugging.md`), so "the app launched cleanly"
says nothing about whether a plugin actually worked. `check` loads the built
bundle in a plain bun process against the host's **real** modules and
**renders it** with `renderToString`. It also prints which host modules the
bundle really pulls in — the seed of the manifest-vs-reality check the
permission model will eventually want.

Both the rendering and the realness are load-bearing, and both are scar
tissue: a first version of this check imported the bundle against stub
modules, never rendered, and passed cleanly on a plugin that crashed on its
first paint in the real app with `dispatcher.getOwner is not a function`.
Anything that doesn't render can't see that class of bug at all.

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

`loadPlugins()` (`src/wigl/plugins/loader.ts`) reads each folder's manifest
and built entry as text through `sh` — the same "shell out, no new Rust" rule
the storage layer follows — prepends a per-plugin header binding the scoped
`require`, and imports the result as a blob URL. Reading through `sh` rather
than serving files over Tauri's asset protocol is what keeps this a
zero-config addition: no capability, `tauri.conf.json`, or Rust change is
needed to install a plugin.

Discovery never throws. A plugin that fails to load comes back as a failure
the app renders on screen, because the alternative — one bad manifest
blanking every widget on the desktop — is exactly what this app's error
boundaries exist to prevent.

`src/App.tsx` holds `<Desktop>` back until discovery settles. That's
deliberate: `<Desktop>` builds its layout from the widget ids it's handed,
and handing it a set that grows a tick later is the same mount-order hazard
that already cost a first-launch layout bug once.

## Migrating a builtin widget to a plugin

`wigl-widgets/calendar/` is the worked example — copy its shape, not just
its idea. Steps, in order:

1. `git mv src/widgets/<name> wigl-widgets/<name>`.
2. Add `wigl-widgets/<name>/manifest.json` — `id` must equal the folder name,
   `entry` is `"dist/index.js"`, `apiVersion` is `PLUGIN_API_VERSION`
   (`src/wigl/plugins/types.ts`). Declare `permissions` for whatever the
   widget actually uses (`storage` if it touches `useStorage`/`useQuery`;
   nothing else exists as a permission yet — see the registry section above).
3. If the widget has its own npm dependencies (calendar has `date-fns`), add
   a `wigl-widgets/<name>/package.json` naming them and `bun install` at the
   repo root so they resolve for the build.
4. `bun run plugin:build wigl-widgets/<name>` — read the error if it fails.
   The two failure modes so far are both host-module gaps: an import not in
   `src/wigl/plugins/host-modules.ts` (add it there and to
   `registry.ts`'s `HOST_MODULES`, gated by permission if it's a capability
   rather than a pure helper), or a deep import past the three shared
   barrels (`@/wigl/Desktop`, `@/wigl/grid/...`) — those are supposed to fail;
   fix the widget's import instead of the registry.
5. `bun run plugin:check wigl-widgets/<name>` — this must pass before
   `typecheck:plugins`, i.e. before touching anything else. It's the only
   step that proves the widget actually renders against the app's real,
   production React; see "NODE_ENV is part of the contract" below for why a
   green `typecheck` here is not sufficient on its own.
6. `bun run typecheck:plugins` — proves the widget compiles against the
   plugin tsconfig (`wigl-widgets/tsconfig.json`, generated `.d.ts`) rather
   than the app's live source. A widget that only compiled by accident
   (deep-importing something the app's root tsconfig happened to resolve)
   fails here even though step 4/5 already passed, because the build step
   externalizes by specifier while this step type-resolves by path — catching
   one doesn't guarantee the other, run both.
7. `bun run plugin:install wigl-widgets/<name>` then `bun run verify` —
   confirm it's on screen. If the widget was one of the four still pending
   (`games`, `qa-colors`, `repos`, `todo` — see `backlog.md`), delete its
   `src/widgets/<name>/` folder once the plugin version is confirmed working,
   so there's exactly one copy of the widget in the repo, not two.

`repos` cannot make it past step 4 as-is: it imports `@tauri-apps/api/path`
and `@tauri-apps/plugin-shell` directly, and plugins are not allowed to hold
a raw Tauri API — see "The host module registry" above for why. It needs the
host to grow mediated `command`/`filesystem` host modules (gated on the
permissions of the same name, already in the manifest schema) before it can
move; that's `backlog.md`'s entry for it, not a step to improvise here.
