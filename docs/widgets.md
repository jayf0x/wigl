# Adding or editing a widget

This file is the contract and the reasoning. It deliberately names no current widgets — for every pattern below, the living example is in `src/widgets/`: open the existing widget most similar to what you're building and read it top to bottom. If this doc and a widget's code ever disagree on style, the code is newer; fix whichever is wrong rather than following the stale one.

## Philosophy (shadcn-style)

Widgets and shared components are **owned code**, not framework surface. A component's API is children + `className` (merged via `cn()` from `@/lib/utils`), not a prop for every conceivable variation — if a widget needs the header green, it passes `className="bg-green-950"`, it doesn't wait for a `background` prop to be added. When a shared component doesn't fit, edit it or don't use it; never grow a config system around it.

## A widget is one folder

The contract, typed by `WidgetModule` in `src/wigl/types.ts`:

```
src/widgets/<name>/
  index.tsx        ← exactly one export: the default-exported component
  use<Name>.ts     ← only if it fetches external data (see below)
  config.ts        ← only if it has tunable constants
  anything else    ← the widget's own business: sub-components, utils, whatever
                     keeps index.tsx readable. Private to the folder — never
                     imported by another widget.
```

Sibling files take plain names (`types.ts`, `commands.ts`, `sort.ts`, a `Row.tsx` component) — the folder itself is already the namespace, so don't prefix filenames with the widget's own name. `use<Name>.ts` is the one deliberate exception: that prefix is the hook-naming convention (see below), not a namespacing habit.

`src/App.tsx` discovers folders with `import.meta.glob("./widgets/*/index.tsx")` at build time; the folder name becomes the widget's id (used as its grid-layout key and its `useStorage`/`useQuery` key prefix), not a window label — a widget renders as a grid item inside whichever monitor's window it's assigned to, it doesn't get its own OS window (see `docs/architecture.md`). Don't name a folder `main` (the hidden bootstrap window) or `wigl` (the app's name). **Adding a widget = creating the folder. Deleting it = removing the folder. No registration, no config edits, nothing else.**

```tsx
// src/widgets/clock/index.tsx — a complete, working widget
import { Widget, WidgetHeader } from "@/wigl";

export default function ClockWidget() {
  return (
    <Widget w={3} h={2} col={8} row={0}>
      <WidgetHeader>
        <span className="px-1 text-[10px] tracking-widest opacity-40">CLOCK</span>
      </WidgetHeader>
      {/* body */}
    </Widget>
  );
}
```

Grid size/position are plain props on `<Widget>` — `w`/`h` in cells (default 3×4), `col`/`row` as a first-launch cell position (omit them and you get the first open slot). There's no separate config export sitting next to `default`: one export means nothing to typo, and grid props are ordinary JSX so TypeScript already catches a mistyped one (App.tsx still warns if it finds a leftover top-level `gridConfig` export, which means a widget predates this and needs its config moved onto `<Widget>`). `col`/`row` only matter the first time a widget is ever seen — the tiling desktop persists wherever the user drags it after that. Pick defaults that don't overlap other widgets' (check their `<Widget>` props in `src/widgets/*/index.tsx`). Window chrome (transparent, undecorated, always-on-bottom, skip-taskbar, non-resizable) is set once per monitor in Rust, not per widget — see "Window chrome" below — so there's no per-widget chrome to configure at all.

No capability or window edit needed either — a new widget adds no window (see above), and `src-tauri/capabilities/default.json`'s `windows` field is a `["*"]` glob regardless. You only touch that file for new *permissions* (see "Running shell commands" below).

## What a real-data widget needs

The shape, in dependency order (any widget in `src/widgets/` with a hook is the reference in action):

1. **A config module** (`config.ts`) — plain exported constants for anything you might want to tweak (poll interval, source paths). No env vars, no settings UI, no runtime config loading.
2. **A data hook** (`use<Name>.ts`) — owns the `setInterval` + shell-command + `useState` cycle described in `docs/architecture.md`. One hook per widget; don't share it across widgets, don't generalize it into a "data fetching framework." Don't add a hook or config until there's actually external data to fetch or a constant to tune — a static widget is just `index.tsx`.
3. **The component** (`index.tsx`) — consumes the hook, renders rows/state, wires up interactions. Wrapped in the shared panel chrome (below). When it grows past comfortable reading length, split sub-components/utils into sibling files in the same folder — that's expected, not a smell.
4. **Import with the `@/` alias**, not relative paths, for anything outside the widget's own folder (`@/wigl`, `@/components/ui/...`). Within a widget's own folder, relative imports are fine.

## Shared helpers (`@/wigl`)

Everything shared is exported from the `@/wigl` barrel — **read `src/wigl/index.ts` for the current list**; each module carries its own doc comment. The two you'll always use:

- **`Widget`** — the dark rounded panel (also forces the `dark` class coss ui needs). Override looks via `className`. Children + `className` only, per the philosophy above.
- **`WidgetHeader`** — a drag handle, and *only* a drag handle. Its single job is making window-drag and clicking coexist: mousedown on anything interactive (`button, a, input, select, textarea`, or any element carrying `data-no-drag`) passes through to the element; mousedown anywhere else starts the window drag. Content is whatever children you pass — a title span, status info, buttons (`ml-auto` to right-align them), nothing at all. **Never** attach `onMouseDown`/`stopPropagation` workarounds inside it, and never import the drag module directly in a widget — if a click is being eaten, add `data-no-drag` to that element instead.

```tsx
<WidgetHeader className="bg-emerald-950/40">
  <span className="px-1 text-[10px] tracking-widest opacity-40">REPOS</span>
  <div className="ml-auto flex items-center gap-0.5">{/* buttons — clicks just work */}</div>
</WidgetHeader>
```

Before writing a utility inside your widget folder, skim the barrel — the helper you need (e.g. live relative-time labels, persisted state) may already exist. Conversely, don't add to `src/wigl/` for a single widget's needs; the promotion threshold is in `docs/architecture.md`.

## Persistent storage (`useStorage`)

```ts
import { useStorage } from "@/wigl";
const [items, setItems, { loading }] = useStorage<Item[]>("<widget>_items", []);
```

`useState` persisted as a JSON blob in a kv table in `wigl.db` under the OS's app-data dir (macOS: `~/Library/Application Support/<id>`, Linux: `~/.local/share/<id>`), via the system's `sqlite3` CLI (no Rust, no Tauri plugin — same "shell out to a real CLI" rule as data fetching). `sqlite3` isn't bundled — ships by default on macOS, `apt install sqlite3` on Ubuntu if it's missing; a widget using `useStorage` with it not installed logs a read/write error but doesn't crash (see `docs/architecture.md`). Writes are optimistic; external changes (another window, a CLI script) are picked up by a poll (a few seconds). Keys must match `[a-zA-Z0-9_-]+` and share one flat namespace across all widgets — **prefix your keys with the widget's folder name** (`calendar_events`, not `events`).

External tools can write the same data: any script in `scripts/` that talks to the DB is the pattern in action (run them via the `bun run` entries in `package.json`). If you build a CLI for a widget's data, copy that shape: same DB path, one kv key, JSON blob, `CREATE TABLE IF NOT EXISTS kv (...)` before use. The contract between widget and CLI is the key **and the JSON shape** — export both the key constant and the TypeScript type from the widget folder and import them in the CLI (scripts run under bun and can import from `src/` directly; don't hand-duplicate the type).

Ceiling to know about: last-writer-wins on the whole blob — two writers mutating the same key within one poll window can drop a write. Fine for single-user widget data; if that ever bites, move that key to its own table with row-level writes.

## Caching expensive calls (`useQuery`)

`useStorage` is for state a widget *owns and writes* (persisted, shared across windows). `useQuery` is the other half: caching the *result of an expensive read* — mainly a shell command you don't want to re-run on every poll tick, especially one with its own rate limit (a GitHub API call via `gh`, say).

```ts
import { useQuery, hours } from "@/wigl";
const [data, loading, { refresh }] = useQuery({
  key: "<widget>_archived",
  fn: loadArchivedRepoNames,
  stale: hours(24),
  useSql: true, // persist across restarts; omit for in-memory-only (resets on relaunch)
});
```

Cached by `key` (prefix it with the widget's folder name, same rule as `useStorage` keys), deduped across concurrent callers, and re-run only once `stale` ms have passed since the last successful fetch — `refresh()` forces it early. `useSql: true` persists the result in the same kv table `useStorage` uses (`query_<key>`, `updatedAt` embedded in the stored blob — no separate invalidation table). It's deliberately not a TanStack Query clone: no retries, no background refetch-on-focus, no error state — if `fn()` throws, the caller sees the rejection, same as calling it directly.

## Running shell commands from a widget

`src-tauri/capabilities/default.json`'s `shell:allow-execute` only registers `sh` and `sqlite3` — `{ "name": "sh", "args": true }` already grants arbitrary execution, so a per-binary allowlist would be decorative. Run everything through `sh -c`:

```ts
import { Command } from "@tauri-apps/plugin-shell";
const output = await Command.create("sh", ["-c", "git status"]).execute();
```

No capability edit needed for a new binary — `sh -c` reaches anything already on `PATH`. Quote your own arguments (`'${s.replace(/'/g, "'\\''")}'`) since `sh -c` takes one string, not an args array — see `revealInFinder`/`openInEditor` in `src/widgets/repos/commands.ts` for the pattern. `Command.create("sh", [...]).execute()` resolves even when the inner command fails — check `out.code !== 0`, don't rely on the promise rejecting.

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

`Widget` forces the `dark` class on its root wrapper since coss ui components read their colors from CSS variables scoped to `:root`/`.dark` in `App.css` — without it, coss components render with the light-theme palette regardless of the app's own dark styling. Widgets built via `Widget` get this for free; don't re-add `dark` on anything inside it.

## Window chrome

A widget never sets its own window chrome — it isn't a window (see `docs/architecture.md`). The standard flags (transparent, undecorated, no shadow, always-on-bottom, skip-taskbar, non-resizable) are set once per monitor window in `src-tauri/src/lib.rs`'s `setup()`. `tauri.conf.json` only declares the hidden `main` bootstrap window. App-level prerequisites, set once: `macOSPrivateApi: true` in `tauri.conf.json` (required for transparency) and the matching `macos-private-api` Cargo feature in `src-tauri/Cargo.toml`.

## Checking a widget's own re-renders

`bun run tauri dev` runs `src/main.tsx`'s dev-only `react-scan` overlay inside every monitor window (see `docs/architecture.md`'s "Render isolation is per-monitor, not per-widget" — widgets sharing a monitor share one render tree, so a re-render caused by one widget can show up on its neighbors' overlay too; that's expected, not a bug to chase). It's gated behind `import.meta.env.DEV`, so it's entirely absent from `bun run build`/`bun run tauri build` output — no prod bundle-size cost, nothing to remember to strip out.
