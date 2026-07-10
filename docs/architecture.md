# Architecture

## The rule

One app renders one widget. `App.tsx` imports one widget component and returns it — nothing else. There is no widget registry, no manifest, no dynamic loading, no `Widget()` wrapper. Swapping widgets means editing `App.tsx`'s import/return and, if the old widget is fully retired, deleting its file. See `INIT.md` in the repo root for the full rationale — read it before changing this. This document assumes you already have.

## What's actually shared

Only two things are window-level, not widget-level, and both live outside any widget file:

- **Dragging** — `src/drag.ts`. A widget opts in by attaching `onMouseDown={onDragHandleMouseDown}` to whichever element should act as the drag handle (usually a header bar). It's a plain function, not a hook or a wrapped component — any interactive child (buttons, rows) inside the drag handle must call `e.stopPropagation()` on its own `onMouseDown`, or its clicks get eaten by the drag start.
- **Window persistence** — `tauri-plugin-window-state`, configured once in `src-tauri/src/lib.rs`. It listens for the native window "moved"/"resized" events and persists automatically; no widget-side code needed. `drag.ts` calls `setPosition()`, which fires the same native event, so manual dragging is transparently persisted too.

Everything else — data fetching, polling, local state, styling — is plain component code scoped to its own widget file. Don't extract a second "shared" hook or utility until a second widget actually needs the same logic; one hook used by one widget is over-engineering with extra steps.

## Data flow pattern

Every widget that needs live system data follows the same shape (see `src/useWigl.ts`):

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

## Extending this app

- **New widget**: see `docs/widgets.md`.
- **New shared window-level behavior** (e.g. resize handles, a tray icon): add it the same way dragging was added — a plain module under `src/`, wired into whichever widget wants it via a prop/handler, no abstraction layer. Only promote something to "shared" once two widgets actually need it identically.
- **New backend capability**: prefer shelling out to a real CLI over writing Rust. Only write a `#[tauri::command]` if the operation genuinely cannot be done via `tauri-plugin-shell` (e.g. it needs to return structured data no CLI provides, or needs to be fast/synchronous in a way shelling out isn't).
