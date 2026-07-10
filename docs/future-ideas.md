# Future ideas / backlog

Everything here is unbuilt and unapproved — a list of things that came up during design exploration (`.idea/full-conversation.md`) or were explicitly deferred in `INIT.md` (repo root). None of it overrides `docs/architecture.md`'s "one app, one widget" rule. Read that file first; treat this one as a menu to pick from later, not a spec to implement.

**Important**: `.idea/full-conversation.md` describes an earlier, much bigger vision — a full widget *platform* with a manifest-free discovery convention (any `.tsx` in a `widgets/` folder auto-registers), a plugin SDK, multi-display "placement engine" that treats widgets as position-independent nodes, and a native tiling layout system. That direction was explicitly rejected — this app is one widget at a time, hand-edited in `App.tsx`. Don't resurrect that architecture piecemeal by building toward it feature-by-feature; if a real need for multiple concurrent widgets ever emerges, that's a deliberate re-architecture decision to make explicitly, not something to slide into.

## Deferred for the repo-status widget specifically (from INIT.md)

- Backlog-item counts per project (would require parsing project-internal files).
- Any parsing of project-internal files beyond git state.
- Settings UI (source directory is currently a hardcoded constant in `reposWidget.config.ts`).
- The npm:deploy-gated three-state badge from the original Übersicht widget (deliberately dropped in favor of a simpler always-checked two-real-state + error scheme).

~~Sorting / multiple header actions~~ and ~~a VS Code open action~~ from the reference widget are now built (2026-07-10) — see `src/ReposWidget.tsx`'s `SORT_ACTIONS`/`SORTERS` and `openInEditor` in `src/useReposWidget.ts`.

## Decided (not just deferred)

- **UI component library: coss ui.** Considered shadcn/ui and Chakra too. Picked coss ui because it's copy-paste like shadcn (no monolithic runtime dependency, components live in `src/components/ui/` as owned code) and Tailwind-v4-native, so it doesn't fight the existing setup. See `docs/widgets.md`'s Styling section for how to add components. Chakra was rejected specifically for being a real runtime dependency with its own styling system, which would compete with Tailwind. Decided 2026-07-10.
- **Monorepo / Turborepo (per-widget package isolation): rejected for now.** Considered so that widgets could have independent, non-conflicting dependency installs (e.g. one widget on a table lib, another on something incompatible). Rejected because only one widget is ever mounted at a time (see `docs/architecture.md`), so there's no actual dependency conflict today — a monorepo here is pure ceremony (extra config, extra install step, more ways for HMR to break) for a problem that doesn't exist yet. Trigger to revisit: multiple widgets need to run **concurrently** (a deliberate architecture change on its own, see below) **and** they need genuinely incompatible dependency versions. Until both are true, everything stays in the single root `package.json`.

## Ideas worth considering if/when they become real needs

- **Multi-display awareness**: if the window ever needs to remember "which display" rather than just x/y, treat display identity as part of the persisted state, not just raw coordinates — a display can disconnect/reconnect at a different position. Not needed today; `tauri-plugin-window-state` already handles simple position/size persistence per-window.
- **Additional widgets**: if a second widget becomes real (not hypothetical), that's the point to reconsider whether anything beyond dragging/window-state should be shared — see `docs/architecture.md` for the threshold ("shared once two widgets actually need it identically").
- **Native tiling / layout**: explicitly out of scope — the OS window manager is the layout engine. Don't build a custom tiling system for a single floating panel.
- **Dev-mode ergonomics**: HMR via `bun run tauri dev` already gives fast iteration; no further tooling investment planned.

## Explicitly not going to happen (don't revisit these)

- Widget manifests / auto-discovery.
- A published/shared hook package.
- A plugin ecosystem or marketplace.
- Cloud sync of any kind.
- Cross-platform support beyond macOS (the window behavior is macOS-only by design; INIT.md is explicit about this).
