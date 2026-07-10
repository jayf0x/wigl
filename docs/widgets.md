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

## Styling

Tailwind utility classes directly in JSX. No CSS modules, no styled-components, no design-token file for a single always-small floating panel. If a second widget needs the exact same visual chrome (panel background, border radius, header bar), that's the point to consider extracting a shared style — not before.

## Window chrome

Transparent/undecorated/always-on-bottom/skip-taskbar window behavior is configured once in `src-tauri/tauri.conf.json` under `app.windows[0]`, plus `macOSPrivateApi: true` (required for transparency) and the matching `macos-private-api` Cargo feature in `src-tauri/Cargo.toml`. This is app-level, not widget-level — a new widget doesn't touch this file unless it needs genuinely different window dimensions/behavior, in which case you're deciding whether it's still "one app, one widget" or something bigger (see `docs/architecture.md`'s hard rule).
