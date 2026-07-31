# Architecture

This explains the window/process model and why it's shaped this way, deliberately at the level of invariants rather than algorithms — the mechanism lives in `src/wigl/Desktop.tsx` and `src-tauri/src/lib.rs`; read those for the "how, in action". Keeping code out of this doc is deliberate: a pasted snippet goes stale the moment the source changes, a pointer to the file doesn't.

## Two window flows: overlay vs. windowed

The app runs in one of two modes, decided once at launch by `windowed_mode()` in `src-tauri/src/lib.rs`'s `setup()` — never mixed, never switched at runtime:

- **Desktop-overlay** (macOS, and Linux under an X11 session): the model described below — fullscreen transparent per-monitor windows glued to the desktop with click-through. This is the default everywhere except Wayland.
- **Windowed** (Linux under Wayland — GNOME's default compositor, so the common case on Ubuntu): a single normal, decorated, resizable, taskbar-visible window, same widgets/grid/drag engine, running as `screen-0`. Wayland compositors don't grant clients absolute window positioning or always-below/always-on-top stacking, so Rust doesn't spawn a window per monitor and doesn't try to pin this one above or below everything else — `always_on_top` isn't set either, since it's the same compositor-policy refusal as always-below under GNOME/Wayland (not a client request Mutter honors), and there's nothing here that would benefit from it anyway with no click-through to pair it with. Click-through itself was tried — Wayland does support per-surface cursor-region ignoring (`wl_surface.set_input_region`, unlike positioning/stacking it's a core protocol feature, not a policy hint a compositor can decline) — but reverted: without always-below/always-on-top to keep the window out of the way, a click passing through empty grid space just focused whatever window was stacked underneath, not the desktop, which made the app feel broken rather than widget-like. The window keeps a light `transparent(true)` touch purely for looks (a near-invisible radial gradient — see `App.css`'s `.wigl-windowed` rule — not the overlay flow's full see-through), specifically because a fully transparent area you can't click through read as confusing rather than desktop-like. `WIGL_MODE=windowed`/`overlay` env var overrides the auto-detection, so this flow is also available by choice on macOS or X11 for anyone who prefers a normal app window over desktop-glued widgets.

The frontend doesn't infer which mode it's in from window flags — it asks Rust directly (`is_windowed_mode` command, checked once in `App.tsx`) and passes a `windowed` prop down to `<Desktop>`, which uses it to skip cross-monitor drag hand-off (no sibling monitor windows exist to hand a drag to) and the hit-rect/drag-active IPC calls (no poller is listening — windowed mode has no click-through). Everything else — the grid engine, storage, widget code — is identical between the two flows; a widget never needs to know which one it's running under.

**Low-priority backlog item, not blocking**: a GNOME Shell extension ([desktop-widgets](https://github.com/NiffirgkcaJ/desktop-widgets)-style) could in principle grant a Wayland client enough positioning/stacking control (the actual gap — always-below/always-on-top, not click-through) to run the real overlay flow under GNOME too. Worth investigating later — not now, since it likely means breaking changes to the positioning contract and needs real QA before it'd be safe to switch GNOME users onto it. See `backlog.md`.

## The rule (desktop-overlay flow)

One `WebviewWindow` per connected monitor (`screen-<i>`, labels assigned left-to-right, all spawned once in `src-tauri/src/lib.rs`'s `setup()` from `available_monitors()`), plus one hidden 1×1 `main` bootstrap window declared in `tauri.conf.json` that renders nothing — it exists only so Tauri has an initial window to boot from before Rust spawns the real ones. (The windowed flow above replaces this whole per-monitor spawn with a single `screen-0` window — see that section for when/why.)

Window count doesn't stay pinned to launch-time monitor count: `spawn_monitor_poller` in `lib.rs` polls `available_monitors()` (the only cross-platform monitor-change signal Tauri exposes) every couple seconds and reconciles — a newly plugged monitor gets appended as the next `screen-<i>`, a removed one has its window closed. Monitor indices are treated as append-only, not fully re-sorted on every change, so an unplug in the middle of a multi-monitor lineup doesn't relabel the survivors. Rust broadcasts the new count over `wigl-monitor-count`; each `<Desktop>` re-reads `available_monitors()` and rebuilds its layout, which is what actually migrates a removed monitor's widgets back to monitor 0 (the existing "saved `m` past the current monitor count means unassigned" fallback in the layout-build effect does the reassignment, no separate code path needed). Windowed mode has none of this — only `screen-0` ever exists there.

**A widget is not a window.** `src/widgets/<name>/index.tsx` has exactly one export — a default-exported component — passing grid size/position as plain props to `<Widget w h col row>` (`src/wigl/widget.tsx`, exported from `@/wigl`). `src/App.tsx` discovers widget folders at build time with Vite's `import.meta.glob("./widgets/*/index.tsx")` and hands the resulting id→module map to every monitor window; each monitor's `<Desktop>` (`src/wigl/Desktop.tsx`) renders whichever subset of widgets is assigned to it, tiled on a shared grid (`src/wigl/grid/math.ts`). Adding a widget = adding a folder — nothing in Rust, `tauri.conf.json`, or the window layer needs to change, because widget count and window count are independent by design.

**Why one window per monitor, not one window per widget or one window total**: dragging, collision reflow, and click-through each need a single clear owner. One giant window spanning every monitor would fight per-monitor scale factors/positions and can't do the fullscreen-transparent-click-through trick per screen. One OS window per *widget* (an earlier design, since replaced) meant every drag went through native window-move APIs — fine for moving a widget within a screen, but it doesn't extend to "move this widget to a different monitor" or "compact everyone's layout" without writing a second position system. One window per monitor gives each screen a single grid to own; widget-to-widget layout becomes ordinary JS state instead of OS-window juggling, and cross-monitor drags become IPC events between monitor windows rather than native window reparenting (which doesn't exist).

**Naming note**: "wigl" is the app (`package.json` name, Tauri `productName`/`identifier`) — never a widget folder's name. Don't create a folder named `main` either — that label is the bootstrap window.

## Render isolation is per-monitor, not per-widget

Widgets sharing a monitor share one JS realm and one React tree — `<Desktop>` mounts every widget it owns as a sibling, each wrapped in its own error boundary so one widget's uncaught render error can't take the others on that screen down with it. There is no isolation *within* a monitor: widgets share one event loop and one render pass, though a widget's own `setInterval`/state still can't reach into another widget's props (they're just sibling components, not a shared store). Isolation exists only *across* monitors, since each is its own WebviewWindow/JS realm. Don't design around per-widget process isolation — it doesn't exist; do keep a widget's own logic scoped to its own folder regardless, same as always.

## What's actually shared

Shared code lives in `src/wigl/` behind exactly three barrels, each `index.ts` the authoritative, always-current list of what it exports — this doc intentionally doesn't duplicate those lists:

- **`@/wigl`** (`src/wigl/index.ts`) — visual/layout primitives: `Desktop`, `Widget`, `WidgetHeader`, `TILING`.
- **`@/wigl/hooks`** (`src/wigl/hooks/index.ts`) — stateful/React helpers: `useStorage`, `useQuery`, `useRelativeTime`, `useRegisterGlobalAction`/`useGlobalActions`.
- **`@/wigl/utils`** (`src/wigl/utils/index.ts`) — plain non-React helpers: `cn`, `runCmd`, `isMacos`, `relativeTime`.

Widgets never deep-import past these three. What belongs where, and why:

- **Grid + drag** — `src/wigl/grid/math.ts` (pure tiling math: cell↔px conversion, collision push, gravity compaction), `src/wigl/grid/config.ts` (every tunable of the tiling desktop), and the drag handling inside `src/wigl/Desktop.tsx` (pointer-driven, CSS-transform based — not native window moves). A widget's position is grid coordinates persisted through `useStorage` and broadcast across monitor windows over `emit`/`listen`, so a cross-monitor drag doesn't wait on a poll tick. Widgets never touch grid math or drag state directly — `WidgetHeader`'s `data-drag-handle` attribute is all a widget needs to opt into dragging.
- **Click-through** — the one thing Rust owns beyond spawning windows: it polls the cursor position against hit-rects each `<Desktop>` reports, toggling native click-through so the cursor passes through empty grid space but is captured over a widget. Paused for the duration of an active drag (flipping it mid-drag would break pointer capture) and while the right-click global-action menu is open (the menu can extend past any hit-rect). This is the only native mechanism in the app beyond window spawning — if a task looks like it needs new Rust, check first whether it actually needs to live at this "one native poller" altitude or whether it's better done in JS.
- **Panel chrome** — the shared panel/header components, following the shadcn philosophy: owned code, children + `className` (merged via `cn()`), no prop-per-feature API.
- **The right-click menu** — `src/wigl/hooks/useGlobalActions.ts`, a small registry any component calls into via `useRegisterGlobalAction({ id, label, run })` for as long as it's mounted; `Desktop.tsx` renders whatever's currently registered (starting with its own "Reset layout" entry) via `useGlobalActions()`. A widget adding its own entry to the menu never touches `Desktop.tsx` or anything else in `wigl` — it just calls the hook.
- **Persistent storage** — `src/wigl/hooks/useStorage.ts` and `useQuery.ts` share one SQLite client (`src/wigl/storage/client.ts`) for a kv table in `wigl.db` under Tauri's per-OS app-data dir (`appDataDir()` — macOS: `~/Library/Application Support/<id>`, Linux: `~/.local/share/<id>`; `<id>` is `src/config/app.ts`'s `APP_IDENTIFIER`, read from `tauri.conf.json` so it can't drift out of sync), read/written by shelling out to the system's `sqlite3` CLI (consistent with "real CLI over Rust commands" below — no Tauri SQL plugin, no Rust). `sqlite3` isn't bundled, so it's an *optional* system dependency: widgets that don't touch storage work with none installed at all; ones that do simply log read/write errors until it's installed (ships by default on macOS, `apt install sqlite3` on Ubuntu) — no install-time check, no postinstall hook, by design, to keep the app's own footprint minimal. Shared ahead of the usual two-consumer threshold deliberately, because its whole point is one DB shared by widgets *and* external CLIs (`scripts/`) — see `docs/widgets.md`'s "Persistent storage".

Everything else — data fetching, polling, local state specific to one widget's own logic — is plain component code scoped to its own `src/widgets/<name>/` folder. **The promotion rule**: don't extract a "shared" hook or utility until a second widget actually needs the *same* logic; one hook used by one widget is over-engineering with extra steps. When something does cross that threshold, move it into `src/wigl/` and export it from the appropriate barrel — that's the entire ceremony.

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

Tauri's `core:default` capability is narrower than it looks. Today's `src-tauri/capabilities/default.json` explicitly grants `core:window:allow-available-monitors` and `core:window:allow-show` on top of `core:default`, because per-monitor layout and un-hiding a widget window at first paint aren't covered by the default set alone — that's the current concrete example, not an exhaustive list. Every new native capability a widget needs (new shell binaries, new window/fs APIs, ...) requires an explicit entry in `default.json`. If you add a Tauri API call and it silently does nothing (no thrown error, no log line), permissions are the first thing to check — see `docs/debugging.md`.

`shell:allow-execute` only registers two binaries — `sh` and `sqlite3` — since `{ "name": "sh", "args": true }` already grants arbitrary execution, making a per-binary allowlist (`open`, `code`, `github`, ...) decorative. Everything shells out through one of those two: run a command as `sh -c "..."` rather than adding a new `name`/`cmd` entry. This is a real boundary only in the "local, trusted machine" sense — it does not sandbox what the app can execute. `execute()` (wait for the full output) and `spawn()` (stream output as it arrives — e.g. to show live progress) are gated by *separate* permissions; `shell:allow-execute` doesn't cover `spawn()`, so a widget that streams output needs its own `shell:allow-spawn` entry too (same `sh` scope — see the repos widget's clone-progress row for the pattern).

`default.json`'s `windows` field is `["*"]` (a glob, matched against window labels), not an explicit per-window list — a new monitor window needs no capability edit, and neither does a new widget (widgets aren't windows). Only touch `default.json` when something needs a new *permission*.

## Dependency placement

`tailwindcss` and `@tailwindcss/vite` are build-only tools that sit in `dependencies` rather than `devDependencies`, while `vite` itself is a devDependency — an inconsistent split, not a deliberate one; `bun install` here always installs both groups before building, so it isn't a live bug. `shadcn` being in `dependencies` looks like the same mistake but isn't: `src/App.css` imports `shadcn/tailwind.css` at runtime, so it's a genuine runtime dependency, not a stray CLI tool.

## Extending this app

- **New widget**: see `docs/widgets.md`.
- **New shared window/monitor-level behavior** (e.g. a tray icon, a new drag interaction): add it the same way the grid engine and click-through were added — a plain module under `src/wigl/` for anything JS-side, or a new `#[tauri::command]` following the existing hit-rect-polling pattern if it genuinely needs to be native. Only promote something to "shared" once two widgets actually need it identically.
- **New backend capability**: prefer shelling out to a real CLI over writing Rust. Only write a `#[tauri::command]` if the operation genuinely cannot be done via `tauri-plugin-shell` (e.g. it needs to return structured data no CLI provides, or needs to be fast/synchronous in a way shelling out isn't) — or, as with click-through, it needs a persistent native poller no webview API can provide.
