# Architecture

This file explains intent and mechanism, deliberately without naming the current widgets or shared helpers — those inventories live in the source (`ls src/widgets/`, `src/wigl/index.ts`) so they can't go stale here. Read this for the "why", then open any widget folder for the "how, in action".

## The rule

One OS window renders one widget, and a widget is one folder. `src/widgets/<name>/index.tsx` has exactly one export — a default-exported component — and passes its grid size/position as plain props to `<Widget w h col row>` (see `src/wigl/widget.tsx`, exported from `@/wigl`). `src/App.tsx` discovers widget folders at build time with Vite's `import.meta.glob("./widgets/*/index.tsx")` — the folder name becomes the window label. There is no registry file, no manifest, no runtime filesystem scanning, no HOC/registration wrapper; the glob is resolved statically by Vite at build time. Adding a widget = adding a folder. Retiring one = deleting it. Nothing else is edited.

**How windows come to exist**: `tauri.conf.json` declares exactly one window — a hidden 1×1 bootstrap labeled `main`. On launch, `App.tsx` (running in `main`) spawns one `WebviewWindow` per widget folder, applying the app's standard window chrome (transparent, undecorated, always-on-bottom, skip-taskbar, non-resizable — hardcoded in the spawner) plus the widget's own grid config. Every window loads the same bundle; each realm looks up its own label in the glob result to decide what to render (`main` renders nothing). The `main` window is denylisted from `tauri-plugin-window-state` in `src-tauri/src/lib.rs` — see `docs/debugging.md` for why that matters.

**Why windows, not one window with several components**: dragging (`src/wigl/drag.ts`) and `tauri-plugin-window-state` (below) already operate at the OS-window level — a window's position is a single (x, y), dragging moves the whole window. Two widgets that need to be independently positioned and dragged therefore need to *be* two windows; stacking them as sibling elements in one window would mean writing a second, incompatible drag/position system from scratch. One window per widget reuses the drag module and window-state persistence completely unchanged, and gets each widget its own JS realm as a side effect — see "Render isolation" below.

**Naming note**: "wigl" is the app (`package.json` name, Tauri `productName`/`identifier`). It is not, and must never become, a widget folder's name — reusing the app's name for a widget is the thing most likely to confuse the next person (or agent) reading this codebase. Also don't create a folder named `main` — that label is taken by the bootstrap window.

## Render isolation between widgets

Every widget window loads the same frontend bundle but runs it in its own WebView — its own JS realm, own React tree, own event loop. A widget's `setInterval`/`useState`/re-renders can never touch another widget's render tree; there is no shared store, no shared React context, no possible cross-widget re-render bleed to guard against. This means: don't build cross-widget memoization, a shared state store, or a "coordinator" of any kind — the isolation is structural, not something application code needs to maintain. If you want to *see* a single widget's own re-renders while developing, `bun run tauri dev` wires up `react-scan` in dev builds only (`src/main.tsx`, gated behind `import.meta.env.DEV` so it's fully absent from production bundles) — each widget's WebView gets its own overlay.

## What's actually shared

Shared code lives in `src/wigl/` and is exported only through the `@/wigl` barrel (`src/wigl/index.ts`) — **that barrel is the authoritative, always-current list of what's shared**; this doc intentionally doesn't duplicate it. What belongs there, and why:

- **Window-level mechanics** — anything that operates on the OS window rather than inside it: the drag handler, and `tauri-plugin-window-state` (configured once in `src-tauri/src/lib.rs`), which listens for native "moved" events and persists position per window label automatically. Manual dragging calls `setPosition()`, which fires the same native event, so drags are transparently persisted too. Widgets never touch the drag module directly — the shared header component is the drag handle, and its whole job is making drag and click coexist (mousedown on anything interactive — `button, a, input, select, textarea`, or anything with `data-no-drag` — passes through; anything else starts the drag).
- **Panel chrome** — the shared panel/header components, following the shadcn philosophy: owned code, children + `className` (merged via `cn()`), no prop-per-feature API.
- **Persistent storage** — the `useStorage` hook: JSON blobs in a kv table in `~/Library/Application Support/wigl/wigl.db`, read/written by shelling out to macOS's built-in `sqlite3` (consistent with "real CLI over Rust commands" below — no Tauri SQL plugin, no Rust). Shared ahead of the usual two-consumer threshold deliberately, because its whole point is one DB shared by widgets *and* external CLIs (`scripts/`) — see `docs/widgets.md`'s "Persistent storage".

Everything else — data fetching, polling, local state specific to one widget's own logic — is plain component code scoped to its own `src/widgets/<name>/` folder. **The promotion rule**: don't extract a "shared" hook or utility until a second widget actually needs the *same* logic; one hook used by one widget is over-engineering with extra steps. When something does cross that threshold, move it into `src/wigl/` and export it from the barrel — that's the entire ceremony.

## Data flow pattern

Every widget that needs live system data follows the same shape (any widget with a `use<Name>.ts` hook is a working example):

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

`shell:allow-execute` only registers two binaries — `sh` and `sqlite3` — since `{ "name": "sh", "args": true }` already grants arbitrary execution, making a per-binary allowlist (`open`, `code`, `github`, ...) decorative. Everything shells out through one of those two: run a command as `sh -c "..."` rather than adding a new `name`/`cmd` entry. This is a real boundary only in the "local, trusted machine" sense — it does not sandbox what the app can execute.

`default.json`'s `windows` field is `["*"]` (a glob, matched against window labels), not an explicit per-window list — so a new widget's window label needs no capability edit. Only touch `default.json` when a widget needs a new *permission* (a new shell binary, a new window/fs API), never just because it's a new window.

## Dependency placement

`tailwindcss` and `@tailwindcss/vite` are build-only tools that sit in `dependencies` rather than `devDependencies`, while `vite` itself is a devDependency — an inconsistent split, not a deliberate one; `bun install` here always installs both groups before building, so it isn't a live bug. `shadcn` being in `dependencies` looks like the same mistake but isn't: `src/App.css` imports `shadcn/tailwind.css` at runtime, so it's a genuine runtime dependency, not a stray CLI tool.

## Extending this app

- **New widget**: see `docs/widgets.md`.
- **New shared window-level behavior** (e.g. resize handles, a tray icon): add it the same way dragging was added — a plain module under `src/wigl/`, exported from the barrel, wired into whichever widget wants it via a prop/handler, no abstraction layer. Only promote something to "shared" once two widgets actually need it identically.
- **New backend capability**: prefer shelling out to a real CLI over writing Rust. Only write a `#[tauri::command]` if the operation genuinely cannot be done via `tauri-plugin-shell` (e.g. it needs to return structured data no CLI provides, or needs to be fast/synchronous in a way shelling out isn't).
