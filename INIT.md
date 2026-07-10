# Wigl — INIT (single source of truth for the build)

This file is the entire spec. Don't read `.idea/full-conversation.md` (superseded — it describes a widget *platform*, which this explicitly is not) or `.idea/uebersicht-master` (reference material only, not a dependency). If something isn't answered here, pick the boring option and note it in your final report — don't stall on it.

## Intent

Replace one specific Übersicht widget I run today with a standalone Tauri app. That's the whole project. Not a framework, not a platform, not an SDK, not a plugin system. One app, one visible widget at a time, built from scratch in this repo.

The one thing that's shared/"core" across widgets: **draggable window behavior** (native window drag via `data-tauri-drag-region` + position/size persistence). That's a platform concern (it's the OS window, not the widget), so it lives once, at the app level. Everything else — layout, state, data fetching, git logic — is plain component code with zero shared abstraction. A widget is just a `.tsx` file that returns JSX. No `Widget()` wrapper, no manifest, no hook package.

## Expected outcome

Two things get built, in order, in the same repo/app:

1. **Clock widget** — trivial, disposable, exists purely to prove the shell works: window renders transparent/undecorated/always-on-bottom, drags, persists position across restart, has HMR. No git logic, no shell commands. A digital clock updating every second is enough.
2. **Wigl widget** — the real deliverable, described in full below. Once Phase 1 confirms the shell works, replace the Clock's contents in `App.tsx` with the Wigl widget. Don't keep both mounted, don't build a switcher — this is still "one app renders one widget," the widget just changes.

Done when Wigl (not Clock) is running, showing real data, and the whole TypeScript surface is small enough to read in one sitting.

## Stack (fixed)

- Tauri 2, React 19, TypeScript, Vite, Tailwind 4.
- Widgets are written in **TSX**, plain function components. No `.jsx`.
- `tauri-plugin-shell` for running `git` commands. No custom Rust beyond what the Tauri template generates. If you find yourself writing a `.rs` file with logic in it, stop — that logic belongs in TypeScript calling shell.
- `tauri-plugin-window-state` for persisting window position/size across restarts.
- No other dependencies unless a feature above is impossible without one. A table is `<div>`s with Tailwind — no table library for a 10-row list.
- Scaffold the Tauri project at the repo root (this repo currently has no `package.json`/`src` — this build creates them, not a subfolder).
- Use **bun** for installs and scripts (`bun install`, `bun run tauri dev`), not npm/yarn/pnpm. `create-tauri-app` supports `--manager bun` at scaffold time.

## Phase 1 — Clock widget

Purpose: QA the app shell before touching git logic.

- `App.tsx` renders a `<Clock />` component: current time, updates every second (plain `setInterval` + `useState`, no library).
- Window is transparent, no decorations, no shadow (or subtle), skip taskbar/dock where the platform allows, `alwaysOnBottom: true`.
- Header/background has `data-tauri-drag-region` so the whole thing drags.
- `tauri-plugin-window-state` restores position/size on relaunch.
- `bun run tauri dev` gives HMR.

Stop here, confirm it works (drag it, restart the app, watch it come back in the same spot), then move to Phase 2.

## Phase 2 — Wigl widget (the actual project)

A small always-on-desktop panel listing my local git projects, each with a release indicator.

### Release indicator — resolved

Port the logic from `.idea/example.widget.jsx`, with one deliberate change: **drop the `npm:deploy` gate.** The old widget only ran the tag/dirty check on repos with an `npm:deploy` script in `package.json`, showing an untracked ⚫ for everything else. Wigl v1 has no third state — every repo in scope gets checked the same way:

- 🟢 — repo has changes to release: dirty working tree (uncommitted changes), or commits since the last tag, or no tag exists at all (never released = counts as "changes to release").
- ⚪ — clean: has a tag, no commits since it, no uncommitted changes.
- ⚠️ — error (not a git repo, git command failed): render the row anyway, error as `title` tooltip. Never crash the whole widget for one bad repo.

### Repo list — resolved

Scan root, not a hardcoded array — mirrors the old widget's `SOURCE_DIR`. Default to `~/Documents/GitHub` (adjust in `config.ts` if wrong), one level deep, directories only.

### Per row

- Project name, indicator, relative time of last commit (e.g. `3h`, `2d` — same style as the old widget's `relTime`).
- Click a row → `open -R` the project folder (reveal in Finder).

Explicitly **v2, do not build now**: backlog-item counts, any parsing of project-internal files, multiple widgets visible at once, widget discovery, settings UI.

### Window behavior

Same window as Phase 1 (transparent, no decorations, `alwaysOnBottom: true`, draggable via header, position/size restored by window-state plugin). macOS only — don't spend effort on cross-platform.

### Data flow (keep it embarrassing)

```
config.ts (scan root)
        ↓
setInterval every 5 min (+ run once on mount)
        ↓
for each repo: shell("git ...") via plugin-shell
        ↓
useState<ProjectStatus[]>
        ↓
React renders rows
```

- No query library, no cache layer, no SQLite, no custom hooks package. One plain `useWigl()` hook inside this app is fine; a shared/published hook is not.
- A manual refresh button is allowed (one button, no shortcut system).

## Hard fences (the actual point of this document)

1. **One app renders one widget at a time.** No `widgets/` folder, no dynamic loading, no manifest, no `Widget()` wrapper, no registration. `App.tsx` renders `<Clock />` in Phase 1, then `<Wigl />` in Phase 2. Done.
2. **Draggable window behavior is the only shared concept**, and it's a window-level config (drag region + window-state plugin), not a custom hook or component API. Nothing else is "shared", "global", or "reusable" — not storage, not fetching, not styling primitives — until a real second concurrently-running widget demands it.
3. **No tiling / layout engine.** The OS window manager is the layout engine.
4. **No performance work.** Ten repos polled every 5 minutes is nothing. If it ever feels slow, measure first.
5. If a task can't be tied to a feature above in one sentence, it's out of scope — skip it and note it at the end instead of building it.

## Done criteria

- `bun run tauri dev` gives HMR on whichever widget is currently mounted.
- Built app launches, shows the panel on the desktop (under other windows), draggable, position survives restart.
- Clock phase: correct time, updates every second.
- Wigl phase: rows show correct 🟢/⚪/⚠️ against my real repos, refresh on interval, Finder reveal works on click.
- Total project fits in a handful of files. A reviewer should be able to read the entire TypeScript in one sitting.

Stop when these pass. Report what was skipped and what v2 items came up while building.
