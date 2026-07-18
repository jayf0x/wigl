# Future ideas / backlog

Everything here is unbuilt and unapproved — a list of things that came up during design exploration (`.idea/full-conversation.md`) or were explicitly deferred in the original build spec (archived at `.idea/INIT.md`). None of it overrides `docs/architecture.md`'s "one window, one widget, one folder" rule. Read that file first; treat this one as a menu to pick from later, not a spec to implement. (Known defects and technical ceilings live in `backlog.md`, not here — this file is product ideas and scope decisions.)

**Important**: `.idea/full-conversation.md` describes an earlier, much bigger vision — a full widget *platform* with a plugin SDK, a multi-display "placement engine" that treats widgets as position-independent nodes, and a native tiling layout system. Two pieces of that vision have since become real by deliberate owner decision (see "Decided" below): multiple concurrent widgets, and folder-based auto-discovery (`import.meta.glob` over `src/widgets/*/index.tsx` — build-time, in-repo, not a runtime plugin mechanism). The rest stays rejected: no plugin SDK, no third-party widget loading, no placement engine, no tiling. Don't resurrect those piecemeal by building toward them feature-by-feature.

## Deferred for the repo-status widget specifically (from the original spec)

- Backlog-item counts per project (would require parsing project-internal files).
- Any parsing of project-internal files beyond git state.
- The npm:deploy-gated three-state badge from the original Übersicht widget (deliberately dropped in favor of a simpler always-checked two-real-state + error scheme).

~~Settings UI~~ (source directory) is now built (2026-07-18) — see the repos widget's `Settings.tsx` and `useReposWidget.ts`'s `repos_source_dir` storage key.

~~Sorting / multiple header actions~~ and ~~a VS Code open action~~ from the reference widget are now built (2026-07-10) — see the repos widget folder.

## Decided (not just deferred)

- **Multiple concurrent widgets: one Tauri window per widget — superseded, see below.** First cut: chosen over rendering multiple widgets as sibling elements inside one window because `src/wigl/drag.ts` and `tauri-plugin-window-state` already operated at the window level (a window has one position; dragging moves the whole window) — one window per widget reused both completely unchanged instead of requiring a second, incompatible in-page drag/position system, and gave each widget its own WebView/JS realm as a side effect. Decided 2026-07-11; replaced the next day once cross-monitor dragging needed layout logic that native per-window dragging couldn't give (see the grid-engine entry below). Kept here for the "why windows" reasoning, which still applies at the per-*monitor* level today.
- **Widget discovery: build-time folder scan, no window per widget.** A widget is `src/widgets/<name>/index.tsx` (default export), discovered by Vite's `import.meta.glob` in `src/App.tsx`; a hidden `main` bootstrap window (the only window in `tauri.conf.json`) is the sole thing Tauri declares statically. This replaced the first multi-widget cut (hand-edited `WIDGETS` map + per-widget `tauri.conf.json` window entries) the same day, on owner direction: adding a widget must touch only its own folder. That part of the decision stands unchanged; what changed the next day (below) is *where* a discovered widget renders. Decided 2026-07-11.
- **One window per monitor + in-window grid engine, replacing one window per widget.** `tauri-plugin-window-state` and per-widget `WebviewWindow`s were dropped in favor of one `WebviewWindow` per connected monitor (spawned in `src-tauri/src/lib.rs`), each rendering a `<Desktop>` that tiles its assigned widgets on a shared grid (`src/wigl/grid.ts`) with pointer-driven, CSS-transform-based dragging instead of native window moves. Rust's job shrank to spawning monitor windows and one click-through cursor poller (`set_hit_rects`/`set_drag_active`). Trigger: cross-monitor dragging (a widget moving from one screen's grid to another's) has no native-window equivalent — "move this window to a different display mid-drag" isn't a thing OS window APIs do cleanly, but reparenting a grid item between two React trees over an IPC event is straightforward. See `docs/architecture.md` for the current model in full. Decided 2026-07-11/12.
- **Shared-component API style: shadcn philosophy.** Owned code, children + `className` (via `cn()`), no prop-per-feature configuration. Concretely: `WidgetHeader` went from `title`/`actions` props to children-only, with its one real job being drag/click coexistence (interactive-element detection + `data-no-drag` escape hatch, replacing the manual `stopPropagation` contract). Decided 2026-07-11.
- **UI component library: coss ui.** Considered shadcn/ui and Chakra too. Picked coss ui because it's copy-paste like shadcn (no monolithic runtime dependency, components live in `src/components/ui/` as owned code) and Tailwind-v4-native, so it doesn't fight the existing setup. See `docs/widgets.md`'s Styling section for how to add components. Chakra was rejected specifically for being a real runtime dependency with its own styling system, which would compete with Tailwind. Decided 2026-07-10.
- **Monorepo / Turborepo (per-widget package isolation): rejected for now.** Considered so that widgets could have independent, non-conflicting dependency installs (e.g. one widget on a table lib, another on something incompatible). Rejected because all widgets ship in one bundle from one `package.json` — there is no dependency conflict until two widgets need genuinely incompatible versions of the same package, which hasn't happened. A monorepo here is pure ceremony (extra config, extra install step, more ways for HMR to break) for a problem that doesn't exist yet. Trigger to revisit: two widgets concretely need incompatible dependency versions. Until then, everything stays in the single root `package.json`.

- **SQLite-backed `useStorage` + CLI write path: built (2026-07-11).** The `.idea/full-conversation.md` storage vision landed in its minimal form: `src/wigl/storage.ts` (kv table of JSON blobs, `sqlite3` CLI via plugin-shell, 3s poll for external changes) plus `scripts/calendar.ts` as the first external writer. Known ceiling (whole-blob last-writer-wins) and the upgrade path are documented in `docs/widgets.md`. No query cache / `useQuery` layer — still not needed.

## Ideas worth considering if/when they become real needs

- **Multi-display awareness**: already true today — `widget_layout` persists a monitor index (`m`) alongside `col`/`row`, not just raw coordinates (see `docs/architecture.md`). What's *not* handled yet is a monitor disconnecting/reconnecting; that gap is tracked in `backlog.md`.
- **Each new widget**: the panel chrome already generalized once (see "Decided" above) — every widget added is the natural point to check whether anything *else* is now duplicated identically across all of them, per `docs/architecture.md`'s sharing threshold. Don't pre-extract before that.
- **Native tiling / layout**: explicitly out of scope — the OS window manager is the layout engine. Don't build a custom tiling system for a single floating panel.
- **Dev-mode ergonomics**: HMR via `bun run tauri dev` already gives fast iteration; no further tooling investment planned.

## Explicitly not going to happen (don't revisit these)

- Widget manifests, or any discovery beyond the build-time `import.meta.glob` folder scan (runtime plugin loading, third-party widget bundles).
- A published/shared hook package.
- A plugin ecosystem or marketplace.
- Cloud sync of any kind.
- Windows support. macOS + Linux (Ubuntu primarily) is the supported range — see `docs/architecture.md`'s overlay/windowed split for how Linux is handled. (This reverses the original spec's macOS-only stance, decided 2026-07-16.)
