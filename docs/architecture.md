# Architecture

## The rule

One OS window renders one widget, and a widget is one folder. `src/widgets/<name>/index.tsx` default-exports the component and may export a `windowConfig` (size / first-launch position / title — type in `src/wigl/types.ts`, exported from `@/wigl`). `src/App.tsx` discovers widget folders at build time with Vite's `import.meta.glob("./widgets/*/index.tsx")` — the folder name becomes the window label. There is no registry file, no manifest, no runtime filesystem scanning, no HOC/registration wrapper; the glob is resolved statically by Vite at build time. Adding a widget = adding a folder. Retiring one = deleting it. Nothing else is edited.

**How windows come to exist**: `tauri.conf.json` declares exactly one window — a hidden 1×1 bootstrap labeled `main`. On launch, `App.tsx` (running in `main`) spawns one `WebviewWindow` per widget folder, applying the app's standard window chrome (transparent, undecorated, always-on-bottom, skip-taskbar, non-resizable — hardcoded in the spawner) plus the widget's own `windowConfig`. Every window loads the same bundle; each realm looks up its own label in the glob result to decide what to render (`main` renders nothing). The `main` window is denylisted from `tauri-plugin-window-state` in `src-tauri/src/lib.rs` — see `docs/debugging.md` for why that matters.

**Why windows, not one window with several components**: `src/wigl/drag.ts` and `tauri-plugin-window-state` (below) already operate at the OS-window level — a window's position is a single (x, y), dragging moves the whole window. Two widgets that need to be independently positioned and dragged therefore need to *be* two windows; stacking them as sibling elements in one window would mean writing a second, incompatible drag/position system from scratch. One window per widget reuses `drag.ts` and window-state persistence completely unchanged, and gets each widget its own JS realm as a side effect — see "Render isolation" below.

**Naming note**: "wigl" is the app (`package.json` name, Tauri `productName`/`identifier`). It is not a widget. Widget folders currently: `src/widgets/repos/` (a repo-status list) and `src/widgets/todo/` (a placeholder). Don't name a future widget "wigl" or reuse the app's name for a widget folder; it's the thing most likely to confuse the next person (or agent) reading this codebase. Also don't create a folder named `main` — that label is taken by the bootstrap window.

## Render isolation between widgets

Every widget window loads the same frontend bundle but runs it in its own WebView — its own JS realm, own React tree, own event loop. A widget's `setInterval`/`useState`/re-renders can never touch another widget's render tree; there is no shared store, no shared React context, no possible cross-widget re-render bleed to guard against. This means: don't build cross-widget memoization, a shared state store, or a "coordinator" of any kind — the isolation is structural, not something application code needs to maintain. If you want to *see* a single widget's own re-renders while developing, `bun run tauri dev` wires up `react-scan` in dev builds only (`src/main.tsx`, gated behind `import.meta.env.DEV` so it's fully absent from production bundles) — each widget's WebView gets its own overlay.

## What's actually shared

These are window-level or cross-widget-UI level, not single-widget-level, and live outside any widget folder:

- **Dragging** — `src/wigl/drag.ts`, a plain mousedown handler that moves the OS window. Widgets don't touch it directly — `WidgetHeader` (below) is the drag handle.
- **Window persistence** — `tauri-plugin-window-state`, configured once in `src-tauri/src/lib.rs`. It listens for the native window "moved"/"resized" events and persists automatically per window label; no widget-side code needed. `drag.ts` calls `setPosition()`, which fires the same native event, so manual dragging is transparently persisted too.
- **Panel chrome** — `src/wigl/widget.tsx` (`Widget`, `WidgetHeader`), imported from `@/wigl`. Extracted once `TodoWidget` needed the exact same dark rounded-panel wrapper and draggable header row `ReposWidget` already had — see the threshold rule below. Both follow the shadcn philosophy: owned code, children + `className` (merged via `cn()`), no prop-per-feature API. `WidgetHeader`'s single responsibility is making drag and click coexist — it starts a window drag on mousedown *unless* the target is interactive (`button, a, input, select, textarea,` or anything with `data-no-drag`), so widgets never touch `drag.ts` or `stopPropagation` themselves.
- **Persistent storage** — `src/wigl/storage.ts` (`useStorage`), imported from `@/wigl`. JSON blobs in a kv table in `~/Library/Application Support/wigl/wigl.db`, read/written by shelling out to macOS's built-in `sqlite3` (consistent with "real CLI over Rust commands" below — no Tauri SQL plugin, no Rust). Promoted to `src/wigl/` deliberately ahead of the two-widget threshold because its whole point is one DB shared by widgets *and* external CLIs (`scripts/calendar.ts`) — see `docs/widgets.md`'s "Persistent storage" section.

Everything else — data fetching, polling, local state specific to one widget's own logic — is plain component code scoped to its own `src/widgets/<name>/` folder. Don't extract a second "shared" hook or utility until a second widget actually needs the *same* logic; one hook used by one widget is over-engineering with extra steps. `Widget`/`WidgetHeader` crossing that threshold is the concrete example of when to promote something, not a license to pre-extract further.

## Data flow pattern

Every widget that needs live system data follows the same shape (see `src/widgets/repos/useReposWidget.ts`, the data hook for the repo-status widget):

```
config (what to fetch / where)
      ↓
setInterval + run-once-on-mount
      ↓
shell command via tauri-plugin-shell
      ↓
useState
      ↓
render
```

No query library, no cache layer, no IPC-based Rust commands for data — shell out to real CLI tools (`git`, `sh`, `open`, ...) and parse stdout. If a future widget needs something a shell command genuinely can't do, that's the point where a Rust command becomes justified — not before.

## Permissions (the thing that will bite you)

Tauri's `core:default` capability does **not** include window position read/write, despite feeling like a basic window operation. Every new native capability a widget needs (new shell binaries, new window APIs, filesystem access, etc.) requires an explicit entry in `src-tauri/capabilities/default.json`. If you add a Tauri API call and it silently does nothing (no thrown error, no log line), permissions are the first thing to check — see `docs/debugging.md`.

Shell commands are scoped by name+binary, not just "shell access": each command you want to run (`git`, `sh`, `open`, ...) needs its own entry under the `shell:allow-execute` permission's `allow` array in `default.json`. Adding a new shell-backed feature almost always means adding a new entry there.

`default.json`'s `windows` field is `["*"]` (a glob, matched against window labels), not an explicit per-window list — so a new widget's window label needs no capability edit. Only touch `default.json` when a widget needs a new *permission* (a new shell binary, a new window/fs API), never just because it's a new window.

## Extending this app

- **New widget**: see `docs/widgets.md`.
- **New shared window-level behavior** (e.g. resize handles, a tray icon): add it the same way dragging was added — a plain module under `src/`, wired into whichever widget wants it via a prop/handler, no abstraction layer. Only promote something to "shared" once two widgets actually need it identically.
- **New backend capability**: prefer shelling out to a real CLI over writing Rust. Only write a `#[tauri::command]` if the operation genuinely cannot be done via `tauri-plugin-shell` (e.g. it needs to return structured data no CLI provides, or needs to be fast/synchronous in a way shelling out isn't).
