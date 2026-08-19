# Adding or editing a widget

This file is the contract and the reasoning. It deliberately names no current widgets — for every pattern below, the living example is in `wigl-widgets/`: open the existing widget most similar to what you're building and read it top to bottom. If this doc and a widget's code ever disagree on style, the code is newer; fix whichever is wrong rather than following the stale one.

**Every widget is built and shipped through the plugin mechanism** — a folder under `wigl-widgets/<name>/`, built and installed separately (`bun run widget:install`), needing no app rebuild to add or remove. "Build, install, and the plugin mechanism" below covers that machinery; everything else in this file is the component contract itself, which is the same regardless of where a widget's folder lives.

## Philosophy (shadcn-style)

Widgets and shared components are **owned code**, not framework surface. A component's API is children + `className` (merged via `cn()` from `@/wigl/utils`), not a prop for every conceivable variation — if a widget needs the header green, it passes `className="bg-green-950"`, it doesn't wait for a `background` prop to be added. When a shared component doesn't fit, edit it or don't use it; never grow a config system around it.

## A widget is one folder

The contract, enforced at build time because TypeScript can't check "this JSX tree's root is `<Widget>`" on its own — that's a render-time shape, not a type: `bun run widget:check` renders the built default export and greps the markup for `<Widget>`'s marker attribute, so a folder that default-exports something else fails the build (see "Build, install, and the plugin mechanism" below). This is a build-boundary check only — nothing inside `<Widget>`/`<WidgetHeader>` enforces nesting at runtime; a widget author who misuses the shared components past what `widget:check` catches is their own call to get wrong, not something worth extra ceremony to prevent.

```
wigl-widgets/<name>/
  package.json     ← optional — deps, permissions, custom entry (below)
  index.tsx        ← exactly one export: the default-exported component
  use<Name>.ts     ← only if it fetches external data (see below)
  config.ts        ← only if it has tunable constants
  anything else    ← the widget's own business: sub-components, utils, whatever
                     keeps index.tsx readable. Private to the folder — never
                     imported by another widget.
```

`loadPlugins()` discovers installed widget folders at startup (below); the folder name *is* the widget's id (used as its grid-layout key and its `useStorage`/`useQuery` key prefix — nowhere else declares it), not a window label — a widget renders as a grid item inside whichever monitor's window it's assigned to, it doesn't get its own OS window (see `docs/architecture.md`). Don't name a folder `main` (the hidden bootstrap window) or `wigl` (the app's name). **Adding a widget = creating the folder + `bun run widget:install`. Deleting it = `bun run widget:rm <id>`. No registration, no config edits, nothing else in the app itself.**

```tsx
// wigl-widgets/clock/index.tsx — a complete, working widget
import { Widget } from "@/wigl";

const ClockWidget = () => (
  <Widget w={3} h={2} col={8} row={0}>
    {/* body */}
  </Widget>
);

export default ClockWidget;
```

Grid size/position are plain props on `<Widget>` — `w`/`h` in cells (default 3×4), `col`/`row` as a first-launch cell position (omit them and you get the first open slot). There's no separate config export sitting next to `default`: one export means nothing to typo, and grid props are ordinary JSX so TypeScript already catches a mistyped one. `w`/`h`/`col`/`row` are all just first-launch hints — the tiling desktop persists wherever the user drags or resizes it after that (every widget ships resizable from all four edges with no opt-in needed; see `Desktop.tsx`'s `onResizeStart`/`onResizeMove`). Pick defaults that don't overlap other widgets' (check their `<Widget>` props in `wigl-widgets/*/index.tsx`). Window chrome (transparent, undecorated, always-on-bottom, skip-taskbar, non-resizable) is set once per monitor in Rust, not per widget — see "Window chrome" below — so there's no per-widget chrome to configure at all; the widget grid items are resizable, the OS windows they live inside aren't.

No capability or window edit needed either — a new widget adds no window (see above), and `src-tauri/capabilities/default.json`'s `windows` field is a `["*"]` glob regardless. You only touch that file for new *permissions* (see "Running shell commands" below).

## Build, install, and the plugin mechanism

This is the loading/build *mechanism* a widget is built and shipped through — not the widget itself (`docs/principles.md`'s naming rule). It lives in `src/wigl/plugins/` (host side) and `scripts/widget.ts` (build/install CLI).

```
bun run widget:build   wigl-widgets/calendar   # source → .wigl/index.js
bun run widget:check   wigl-widgets/calendar   # load it headlessly, report host modules used
bun run widget:install wigl-widgets/calendar   # build (if there's source), then copy into app data
bun run widget:add     <git-url> [id]          # clone, build, install — no wigl-widgets/ checkout needed
bun run widget:list
bun run widget:rm      calendar
```

Omit the dir argument on `build`/`install` to sweep every `wigl-widgets/<name>/` folder at once (a folder starting with `_`, e.g. `_qa-color`, is skipped by the no-arg sweep but still buildable/installable by name). `bun run qa`/`bun run verify` already call `widget:install` with no argument before launching. **Renaming or deleting a folder does not remove its old installed copy** — run `bun run widget:rm <old-id>` yourself as part of any rename.

`widget:add` clones the URL into a throwaway temp dir (named after the target id, so no separate override path is needed — `id` defaults to the URL's last path segment, minus a trailing `.git`), then runs the normal build+install path on it — the clone itself is discarded once installed, nothing is vendored into this repo. This only runs under `bun` (real `git`, `node:fs`, `Bun.build`), so it's a CLI-only capability — the Settings modal's Widgets section can't call into it (see that file's own comment for why), which is why "install from a URL, from the Settings modal" stays a separate, harder, still-open gap in `backlog.md`: a webview has no TypeScript bundler, so an in-app version could only ever support a widget that already ships pre-built JS, not one with `index.tsx` source to compile.

`package.json` is optional and does triple duty:
- **`dependencies`** — ordinary npm deps, bundled into *that widget's own* `.wigl/index.js` (each widget gets its own bundle, not one shared one, so one widget's third-party libraries never bloat another's).
- **`main`** — overrides the entry path (defaults to `.wigl/index.js`). Point it at hand-written, already-built JS to skip `widget:build` entirely; still must be a single self-contained ES module.
- **`wigl.permissions`** — declares which gated host-module capabilities (`storage`, `command`, `filesystem`, `network`, `pty`) the widget may use; see `wigl-widgets/widget.schema.json`.

**The host module registry is the actual security/dependency boundary.** A widget's bundle contains only its own code and its own npm deps — every specifier in `src/wigl/plugins/host-modules.ts` (`react`, `@/wigl`, `@/wigl/hooks`, `@/wigl/utils`, shadcn UI, `lucide-react`) is rewritten at build time into a call the host answers at load time. That's what keeps exactly one React in the process, and it's the only place a capability can be withheld — `@tauri-apps/*` is deliberately *not* on the list, so a widget can never hold a raw IPC handle; needing something the registry doesn't serve means adding a host module (`src/wigl/plugins/registry.ts` enforces `wigl.permissions` per-module *and* per-export), not an escape hatch. **Honest caveat**: this isn't a sandbox — a widget's code runs in the same JS realm as the host with `csp: null`, and `command`/`filesystem` permission is already broad access. Treat an installed widget as code you chose to trust, like a browser extension with broad host permissions, not as something sandboxed from the app. See `backlog.md`.

**A widget can `import "./whatever.css"`** from its own source (not through a host module) — `Bun.build`'s CSS loader bundles it into a sibling `index.css`, `widget:install` copies it alongside `index.js`, and `loadPlugins()` injects it as a `<style>` tag at load time.

**A widget can also ship `settingsSection.tsx`**, a sibling of `index.tsx` — built to `settingsSection.js` and installed alongside `index.js` the same way as the CSS sibling above, but loaded and registered independently of the widget's component (see "Contributing a Settings section" below).

**`widget:build`/`widget:check` require `NODE_ENV=production`** (the `widget:*` package scripts already set it) — Bun resolves React's dev-vs-production build from `NODE_ENV` at process start, and a `jsxDEV` bundle meeting the host's production React crashes with "dispatcher.getOwner is not a function". `widget:check` matters because a webview's console is invisible to `bun run verify` — it loads the built bundle against the host's **real** modules and **renders it** with `renderToString`, which is also how it enforces the `<Widget>` export contract (the rendered markup must include `data-wigl-widget`). This is a headless correctness probe borrowing React's server renderer, not real SSR (wigl has no server) — `useEffect` never fires under it, so a widget's actual data-fetch path is out of scope for `widget:check`; see `docs/debugging.md` for how a widget's live behavior gets verified instead.

**Typechecking** (`bun run typecheck:widgets`) resolves `@/...` against generated `.d.ts` under `wigl-widgets/types/` (`bun run widget:types`), never `../src` directly — a widget that only compiled by accident (deep-importing something the app's root tsconfig happened to resolve) fails here even if the build already passed, since the two check different things (specifier externalization vs. path resolution) — run both.

**A widgets folder doesn't have to live inside this repo.** `bun run widget:build <dir>`/`widget:install <dir>` already accept any path; the no-arg "every widget" sweep instead reads `WIGL_WIDGETS_ROOT` (default `wigl-widgets`), and `widget:install`/`list`/`rm` read `WIGL_APP_DATA_DIR` to override where installs land (default: the OS's real Tauri app-data dir) — set it when you want to test an install without touching the real app's plugin set. A widget folder moved out of the repo still needs something to typecheck against: `bun run widget:devkit <dest>` exports a self-contained `tsconfig.json` + `types/` + the exact `@types/react`/`csstype` this repo is pinned to (vendored, since `tsc`'s ancestor `node_modules` walk finds nothing once the folder's outside the repo) — drop widget folders next to that output and `tsc -p <dest> --noEmit` typechecks them the same way `typecheck:widgets` does in-repo. `tests/e2e/` is the test suite proving all of this end-to-end and the reference for extending it.

**Loading**: `loadPlugins()` (`src/wigl/plugins/loader.ts`) reads each installed folder's `package.json`/entry as text through `sh`, prepends a per-widget header binding the scoped `require`, and imports the result as a blob URL — no capability, `tauri.conf.json`, or Rust change needed to install a widget. Discovery never throws; a widget that fails to load comes back as a failure the app renders on screen rather than blanking every other widget.

## What a real-data widget needs

The shape, in dependency order (any widget in `wigl-widgets/` with a hook is the reference in action):

1. **A config module** (`config.ts`) — plain exported constants for anything you might want to tweak (poll interval, source paths). No env vars, no settings UI, no runtime config loading.
2. **A data hook** (`use<Name>.ts`) — owns the `setInterval` + shell-command + `useState` cycle described in `docs/architecture.md`. One hook per widget; don't share it across widgets, don't generalize it into a "data fetching framework." Don't add a hook or config until there's actually external data to fetch or a constant to tune — a static widget is just `index.tsx`.
3. **The component** (`index.tsx`) — consumes the hook, renders rows/state, wires up interactions. Wrapped in the shared panel chrome (below). When it grows past comfortable reading length, split sub-components/utils into sibling files in the same folder — that's expected, not a smell.
4. **Import with the `@/` alias**, not relative paths, for anything outside the widget's own folder (`@/wigl`, `@/components/ui/...`). Within a widget's own folder, relative imports are fine.

## Shared helpers (`@/wigl`, `@/wigl/hooks`, `@/wigl/utils`)

Everything shared lives behind exactly three barrels — widgets never deep-import past them:

- **`@/wigl`** — visual/layout primitives: `Widget`, `Desktop`, `TILING`.
- **`@/wigl/hooks`** — stateful/React helpers: `useStorage`, `useQuery`, `useRelativeTime`, `useRegisterGlobalAction`.
- **`@/wigl/utils`** — plain non-React helpers: `cn`, `runCmd`, `isMacos`, `relativeTime`.

**Read each barrel's `index.ts` for the current list**; each module carries its own doc comment. The two you'll always use from `@/wigl`:

- **`Widget`** — the dark rounded panel (also forces the `dark` class coss ui needs). Override looks via `className`. Children + `className` only, per the philosophy above — with one exception: `minimizedBackground?: ReactNode`, flex-centered full-bleed behind the minimized split-view (see below). This is per-widget content, not a style override, which is why it's a named prop rather than something `className` could express.
- **`WidgetHeader`** — a title bar, plus two fixed controls every widget gets for free: close and minimize (top-left, macOS traffic-light order, set off from your own title/buttons by a right-hand divider), before your own children, synced to storage and driven by `<Widget>`/`Desktop.tsx` — nothing to wire up. Close unmounts the widget entirely (no render, no reflow, no hit-testing) until it's reopened from the "closed widgets" section of the desktop's right-click menu. Dragging lives on a small grip at the header's top-right corner (`data-drag-handle`), not the header at large — the rest of the header (close/minimize, title, your own buttons) is ordinary interactive content, so text stays selectable and a click on a header button never gets mistaken for a drag. Resizing lives entirely outside the header, on thin handles inset along the widget's own outer edges (`Desktop.tsx`'s `WidgetItem`), so it never competes with the grip or the header's own buttons. The header as a whole still carries `data-widget-header`, which is what scopes the desktop's right-click global-commands menu — right-clicking a widget's *body* falls through to the normal browser/webview context menu (so pasting into a textarea works) rather than opening global commands. Content is whatever children you pass — a title span, status info, your own buttons (`ml-auto` to right-align them against the drag grip), nothing at all. **Never** attach `onMouseDown`/`stopPropagation` workarounds inside it, and never import the drag module directly in a widget. Don't add your own close/minimize button — these two are already there.

  Minimize forces the widget to 1x1 and swaps the whole header for a dedicated minimized layout — there's no room for the full header at that size, so it isn't a shrunk copy of it: a 50/50 split with a semi-transparent background, expand on the left, a full-height drag handle on the right, always on top and not overridable. `minimizedBackground` renders centered underneath that split, full-bleed — an icon, an emoji, or your own `bg-[url(...)]` div; the widget itself keeps rendering underneath regardless (state, polling, etc. all keep running), it just isn't shown. Close isn't available while minimized (reopen a fully closed widget from the right-click menu's "closed widgets" section instead) — there's no width for a third control in a 1x1 tile.

```tsx
<Widget minimizedBackground={<CalendarIcon className="size-4" />}>
  {/* body */}
</Widget>
```

Before writing a utility inside your widget folder, skim the barrels — the helper you need (e.g. live relative-time labels, persisted state) may already exist. Conversely, don't add to `src/wigl/` for a single widget's needs; the promotion threshold is in `docs/architecture.md`.

## The desktop's right-click menu (`useRegisterGlobalAction`)

```ts
import { useRegisterGlobalAction } from "@/wigl/hooks";
useRegisterGlobalAction({ id: "<widget>_do-thing", label: "Do thing", run: () => doThing() });
```

Adds an entry to the desktop's right-click menu for as long as the calling component is mounted — no `Desktop.tsx` or `wigl` edit needed. `id` should be prefixed with the widget's folder name, same rule as storage keys, since the registry is a single flat namespace across every widget's menu entries.

## Contributing a Settings section (`settingsSection.tsx`)

An optional sibling of `index.tsx`, default-exporting a `SettingSection`:

```tsx
// settingsSection.tsx
import { type SettingSection, useStorage } from "@/wigl/hooks";

const MyWidgetSettings = () => {
  const [thing, setThing] = useStorage("<widget>:thing", false);
  // ...your own UI, reading/writing state via useStorage
};

const settingsSection: SettingSection = {
  id: "<widget>",
  label: "Widget Name",
  fields: [{ id: "<widget>-thing", label: "Thing", keywords: ["optional", "search", "terms"] }],
  render: () => <MyWidgetSettings />,
};

export default settingsSection;
```

Built and installed alongside `index.tsx` (`scripts/widget.ts`'s `findSettingsSource`) and registered by the loader when the plugin loads (`src/wigl/plugins/loader.ts`), not by the widget's own component — so the section stays in the general Settings modal (right-click → Settings) even while the widget itself is hidden/closed, unlike `useRegisterGlobalAction`'s while-mounted right-click menu entries. `render` returns your own hand-built UI for the section body (a toggle row, a form, whatever fits — same freedom as the widget's own rendering); `fields` is a separate, lightweight list purely for the modal's search box to match against, not a second description of the UI — one entry per control is enough. Back the section's own state with `useStorage` the same way any other widget state would be (see `wigl-widgets/todo/settingsSection.tsx` for a minimal real example: one boolean field that flips the widget's own background live) — a widget's settings are exactly the kind of thing that should apply instantly, no restart. Must be named exactly `settingsSection.tsx`/`.ts` — not `settings.tsx`, which collides on a case-insensitive filesystem with the generic name a widget's own internal settings-panel component might already use (see `repos/Settings.tsx`).

## Persistent storage (`useStorage`)

```ts
import { useStorage } from "@/wigl/hooks";
const [items, setItems, { loading }] = useStorage<Item[]>("items", []);
```

`useState` persisted as a JSON blob in a kv table in `wigl.db` under the OS's app-data dir (macOS: `~/Library/Application Support/<id>`, Linux: `~/.local/share/<id>`), via the system's `sqlite3` CLI (no Rust, no Tauri plugin — same "shell out to a real CLI" rule as data fetching). `sqlite3` isn't bundled — ships by default on macOS, `apt install sqlite3` on Ubuntu if it's missing; a widget using `useStorage` with it not installed logs a read/write error but doesn't crash (see `docs/architecture.md`). Writes are optimistic; external changes (another window, a CLI script) are picked up by a poll (a few seconds). Keys must match `[a-zA-Z0-9_:-]+`; the registry auto-prefixes every key a widget passes with `<widget-id>:` (`src/wigl/plugins/registry.ts`'s `createPluginRequire`), so two widgets picking the same key string never collide — write plain keys (`"events"`, not `"calendar_events"`), the widget never sees or writes the raw un-prefixed one.

External tools can write the same data: any script in `scripts/` that talks to the DB is the pattern in action (run them via the `bun run` entries in `package.json`). If you build a CLI for a widget's data, copy that shape: same DB path, one kv key, JSON blob, `CREATE TABLE IF NOT EXISTS kv (...)` before use. A CLI talks to sqlite directly, outside the registry, so it doesn't get the auto-prefix for free — **write the key as `<widget-id>:<key>` by hand** to land in the same row the widget reads (`wigl-widgets/calendar/cli.ts` is the reference). The contract between widget and CLI is the key **and the JSON shape** — export both the key constant and the TypeScript type from the widget folder and import them in the CLI (scripts run under bun and can import from `src/` directly; don't hand-duplicate the type).

Ceiling to know about: last-writer-wins on the whole blob — two writers mutating the same key within one poll window can drop a write. Fine for single-user widget data; if that ever bites, move that key to its own table with row-level writes.

## Caching expensive calls (`useQuery`)

`useStorage` is for state a widget *owns and writes* (persisted, shared across windows). `useQuery` is the other half: caching the *result of an expensive read* — mainly a shell command you don't want to re-run on every poll tick, especially one with its own rate limit (a GitHub API call via `gh`, say).

```ts
import { useQuery, hours } from "@/wigl/hooks";
const [data, loading, { refresh }] = useQuery({
  key: "archived",
  fn: loadArchivedRepoNames,
  stale: hours(24),
  useSql: true, // persist across restarts; omit for in-memory-only (resets on relaunch)
});
```

Cached by `key` (auto-prefixed with the widget's folder name, same as `useStorage` keys — see above), deduped across concurrent callers, and re-run only once `stale` ms have passed since the last successful fetch — `refresh()` forces it early. `useSql: true` persists the result in the same kv table `useStorage` uses (`query_<key>`, `updatedAt` embedded in the stored blob — no separate invalidation table). It's deliberately not a TanStack Query clone: no retries, no background refetch-on-focus, no error state — if `fn()` throws, the caller sees the rejection, same as calling it directly.

## Running shell commands from a widget

A widget never imports `@tauri-apps/plugin-shell` directly — a widget can't hold a raw Tauri API at all (see "Build, install, and the plugin mechanism" above). It calls `runCmd`/`runCmdStreaming` from `@/wigl/utils` instead, gated on the `command` permission; `wigl-widgets/repos/commands.ts` is the reference:

```ts
import { runCmd } from "@/wigl/utils";
const output = await runCmd("sh", ["-c", "git status"]);
```

`src-tauri/capabilities/default.json`'s `shell:allow-execute` only registers `sh` and `sqlite3` — `{ "name": "sh", "args": true }` already grants arbitrary execution, so a per-binary allowlist would be decorative. No capability edit needed for a new binary — `sh -c` reaches anything already on `PATH`. Quote your own arguments (`'${s.replace(/'/g, "'\\''")}'`) since `sh -c` takes one string, not an args array — see `revealInFileManager`/`openInEditor` in `wigl-widgets/repos/commands.ts` for the pattern. `runCmd` resolves even when the inner command fails — check `out.code !== 0`, don't rely on the promise rejecting.

Streaming a long-running command's output as it arrives (a progress bar, live log lines) needs `runCmdStreaming` instead of `runCmd` — but it's gated by a *different* permission (`command` covers both, but the underlying Tauri capability is `shell:allow-spawn`, not covered by `shell:allow-execute`), so it needs its own capability entry with the same `sh` scope. See `runCmdStreaming` in `src/wigl/utils/index.ts` (used by `cloneRepo` in `wigl-widgets/repos/commands.ts`) for the pattern.

**GUI-launched shells have a minimal `PATH`** — it doesn't source `.zshrc`/`.bash_profile`, so Homebrew (`/opt/homebrew/bin`), `nvm`/`bun`-style installers, and per-app "install CLI" steps (VS Code's, GitHub Desktop's) are all typically missing. Anything you shell out to that isn't a macOS system binary needs its absolute install path tried first, with the bare command as a PATH fallback for machines where it *does* resolve — see the same `commands.ts` for the pattern (a small `for (const candidate of [absolute, bare]) { ... if success return }` loop), repeated for every one of these binaries so far (VS Code, GitHub Desktop, `gh`, `bun`).

Only add a new `name`/`cmd` entry under `shell:allow-execute` if you have a concrete reason to scope a specific binary tighter than the blanket `sh` grant — check via `log show` if a call still fails silently (see `docs/debugging.md`).

**A shell command that's grown past a few lines is easier to keep as a real script than an embedded string.** Put it in `scripts/<name>.ts` (bun, plain functions — no shell-string escaping to get wrong), give it a `bun run <name>` entry so it's runnable and debuggable standalone, and have the widget's hook shell out to it (`sh -c "bun <absolute path to the script> <args>"`, same PATH caveat as above applies to `bun` itself). Share types between the script and the widget by defining them in the widget's folder and importing into the script — not the other way around, since the script uses Node/bun-only APIs that the root `tsconfig.json` (`"include": ["src"]`) doesn't have types for; importing *from* `scripts/` into `src/` would pull an unchecked file into the typechecked program.

## Icons

Use `lucide-react` (already a dependency, pulled in by the coss ui init) rather than emoji glyphs — crisper at small sizes, themeable via `currentColor`/`fill`, and consistent with coss ui's own icon usage. Check the icon name actually exists before importing it: `ls node_modules/lucide-react/dist/esm/icons/ | grep <keyword>` — names sometimes differ from what you'd guess (e.g. it's `TriangleAlert`, not `AlertTriangle`, as the primary export; both exist but one is an alias).

## Styling

Tailwind utility classes directly in JSX. No CSS modules, no styled-components. Never `dangerouslySetInnerHTML` (CSP is disabled; see AGENTS.md hard rules).

For real UI primitives (tables, dialogs, form controls — anything beyond what a few div/flex utility classes reasonably express), use **coss ui** (`coss.com/ui`, aka `@coss/*`), a copy-paste component set built on Base UI + Tailwind v4. It works through the `shadcn` CLI:

```bash
bunx shadcn@latest add @coss/<component>   # e.g. @coss/table, @coss/dialog, @coss/select
```

This drops a real `.tsx` file into `src/components/ui/`, which you own and can edit like any other file — it is not a runtime dependency you import from `node_modules`. Component names come from the registry list (`bunx shadcn@latest view @coss/ui` prints it) — note the registry path is `@coss/<name>` (e.g. `@coss/table`), not `@coss/ui/components/<name>`.

Init already ran once (`components.json`, `@/*` path alias in `tsconfig.json` + `vite.config.ts`, `src/lib/utils.ts`, and the design-token theme in `src/App.css`) — you don't need to redo that, just run `add` for whatever component you need. Only pull in a component when a widget actually needs that primitive; don't pre-install the full set "just in case."

`Widget` forces the `dark` class on its root wrapper — `App.css` defines no color values at all now (`src/wigl/theme/` is the single source, see its own comment), so `dark` no longer picks a different palette; it only activates coss ui's own `dark:`-prefixed variant tweaks (opacity/shadow-direction fine-tuning, not colors). Widgets built via `Widget` get this for free; don't re-add `dark` on anything inside it.

Reach for semantic color tokens (`bg-card`, `border-border`, `text-muted-foreground`, `bg-popover`, `bg-input`, ...), never a literal Tailwind color (`bg-neutral-900`, `border-white/10`, `text-cyan-400` for anything but a genuinely fixed status/icon color) or an inline hex/rgba — a theme (`src/wigl/theme/`) rewrites the CSS vars those tokens read from, and a literal color silently opts a widget out of every future theme. Status-style icon colors that carry fixed meaning regardless of theme (a green "success" check, a red-vs-amber severity gradient) are the one legitimate exception — see `wigl-widgets/repos/Row.tsx`'s `releaseScoreClass` for the pattern.

## Testing

A widget can add a `tests/` folder (or colocated `*.test.ts`/`*.test.tsx` files) using `bun:test` — no framework to install, no config, nothing `widget:build`/`widget:install` needs to know about (they only ever touch `index.tsx`/`index.ts`, `package.json`, and the built `.wigl/` entry, so test files are invisible to the build regardless of where they live). Run them through the root `wigl` CLI (`scripts/wigl.ts`, aliased globally in `.bashrc`), not `bun test` directly — it scopes discovery so a stray `.test.ts` elsewhere in the repo doesn't get swept in:

```bash
wigl test              # everything: wigl-widgets/*/tests + src/wigl
wigl test widgets      # only wigl-widgets/<name>/tests/**/*.test.ts(x)
wigl test shared       # only src/wigl/**/*.test.ts(x)
```

Best suited to pure logic (parsing, formatting, grid math — see `src/wigl/grid/math.test.ts`) since there's no DOM/Tauri runtime in the test process; a widget's rendered behavior is still verified by hand per `docs/debugging.md`, not automated.

## Window chrome

A widget never sets its own window chrome — it isn't a window (see `docs/architecture.md`). The standard flags (transparent, undecorated, no shadow, always-on-bottom, skip-taskbar, non-resizable) are set once per monitor window in `src-tauri/src/lib.rs`'s `setup()`. `tauri.conf.json` only declares the hidden `main` bootstrap window. App-level prerequisites, set once: `macOSPrivateApi: true` in `tauri.conf.json` (required for transparency) and the matching `macos-private-api` Cargo feature in `src-tauri/Cargo.toml`.

## Checking a widget's own re-renders

`bun run tauri dev` runs `src/main.tsx`'s dev-only `react-scan` overlay inside every monitor window (see `docs/architecture.md`'s "Render isolation is per-monitor, not per-widget" — widgets sharing a monitor share one render tree, so a re-render caused by one widget can show up on its neighbors' overlay too; that's expected, not a bug to chase). It's gated behind `import.meta.env.DEV`, so it's entirely absent from `bun run build`/`bun run tauri build` output — no prod bundle-size cost, nothing to remember to strip out.
