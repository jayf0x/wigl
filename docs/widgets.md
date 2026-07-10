# Adding or editing a widget

## A widget is just a component

No base class, no `Widget()` wrapper, no manifest file, no registration step. A widget is a `.tsx` file exporting a function component that returns JSX. That's the entire contract.

## Swapping the active widget

`App.tsx` renders exactly one widget:

```tsx
import { Wigl } from "./Wigl";
import "./App.css";

function App() {
  return <Wigl />;
}
```

To switch to a different widget, change the import and the returned element. To retire a widget for good, delete its file too — don't leave dead widgets around "in case," and don't build a way to switch between them at runtime. If you're prototyping a new widget alongside an existing one, do it on a branch or just accept the churn of editing `App.tsx` back and forth — it's a one-line edit, not a feature to build around.

## What a real-data widget needs

Looking at `src/Wigl.tsx` + `src/useWigl.ts` as the reference shape:

1. **A config module** (`src/config.ts`) — plain exported constants for anything you might want to tweak (poll interval, source paths). No env vars, no settings UI, no runtime config loading.
2. **A data hook** (`src/useWigl.ts`) — owns the `setInterval` + shell-command + `useState` cycle described in `docs/architecture.md`. One hook per widget; don't share it across widgets, don't generalize it into a "data fetching framework."
3. **The component** (`src/Wigl.tsx`) — consumes the hook, renders rows/state, wires up interactions (click-to-act, buttons).
4. **A drag handle** — attach `onMouseDown={onDragHandleMouseDown}` (from `src/drag.ts`) to whatever should drag the window, typically a header. Any button/interactive element inside that header needs `onMouseDown={(e) => e.stopPropagation()}` or the drag handler will eat its click before `onClick` ever fires.

## Running shell commands from a widget

Use `Command.create(name, args)` from `@tauri-apps/plugin-shell`, e.g.:

```ts
import { Command } from "@tauri-apps/plugin-shell";
const output = await Command.create("git", ["status"]).execute();
```

The `name` here (`"git"`) must match a `name` entry under `shell:allow-execute` in `src-tauri/capabilities/default.json`, which maps it to an actual binary (`cmd`) and an args policy. **New binary → new capability entry**, or the call fails silently or with a permission error at runtime (check via `log show`, not visually — see `docs/debugging.md`). If you need a whole pipeline (multiple commands, conditionals), it's usually simpler to write one `sh -c "..."` script string (see `scanScript` in `useWigl.ts`) than to orchestrate multiple `Command.create` calls from JS.

`cmd` can be a fixed absolute path, not just a bare binary name — e.g. `openInEditor` in `useWigl.ts` calls the bundled VS Code CLI at its full app-bundle path (`name: "code"`, `cmd: "/Applications/Visual Studio Code.app/.../bin/code"`) rather than relying on `$PATH`, since GUI apps launched outside a shell often have a minimal `PATH` that doesn't include user-installed CLI tools. Prefer passing args as an array (`Command.create("open", ["-a", "X", path])`) over interpolating a path into a shell string — it sidesteps shell-quoting/injection entirely for the common case, only reach for `sh -c` when you genuinely need shell features (pipes, conditionals, `||` fallback chains).

## Icons

Use `lucide-react` (already a dependency, pulled in by the coss ui init) rather than emoji glyphs — crisper at small sizes, themeable via `currentColor`/`fill`, and consistent with coss ui's own icon usage. Check the icon name actually exists before importing it: `ls node_modules/lucide-react/dist/esm/icons/ | grep <keyword>` — names sometimes differ from what you'd guess (e.g. it's `TriangleAlert`, not `AlertTriangle`, as the primary export; both exist but one is an alias).

## Styling

Tailwind utility classes directly in JSX. No CSS modules, no styled-components.

For real UI primitives (tables, dialogs, form controls — anything beyond what a few div/flex utility classes reasonably express), use **coss ui** (`coss.com/ui`, aka `@coss/*`), a copy-paste component set built on Base UI + Tailwind v4. It works through the `shadcn` CLI:

```bash
bunx shadcn@latest add @coss/<component>   # e.g. @coss/table, @coss/dialog, @coss/select
```

This drops a real `.tsx` file into `src/components/ui/`, which you own and can edit like any other file — it is not a runtime dependency you import from `node_modules`. Component names come from the registry list (`bunx shadcn@latest view @coss/ui` prints it) — note the registry path is `@coss/<name>` (e.g. `@coss/table`), not `@coss/ui/components/<name>`.

Init already ran once (`components.json`, `@/*` path alias in `tsconfig.json` + `vite.config.ts`, `src/lib/utils.ts`, and the design-token theme in `src/App.css`) — you don't need to redo that, just run `add` for whatever component you need. Only pull in a component when a widget actually needs that primitive; don't pre-install the full set "just in case."

Wigl's panel forces the `dark` class on its root wrapper (`<div className="dark ...">`) since coss ui components read their colors from CSS variables scoped to `:root`/`.dark` in `App.css` — without it, coss components render with the light-theme palette regardless of the app's own dark styling.

## Window chrome

Transparent/undecorated/always-on-bottom/skip-taskbar window behavior is configured once in `src-tauri/tauri.conf.json` under `app.windows[0]`, plus `macOSPrivateApi: true` (required for transparency) and the matching `macos-private-api` Cargo feature in `src-tauri/Cargo.toml`. This is app-level, not widget-level — a new widget doesn't touch this file unless it needs genuinely different window dimensions/behavior, in which case you're deciding whether it's still "one app, one widget" or something bigger (see `docs/architecture.md`'s hard rule).
