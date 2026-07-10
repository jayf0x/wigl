# Future ideas / backlog

Everything here is unbuilt and unapproved — a list of things that came up during design exploration (`.idea/full-conversation.md`) or were explicitly deferred in `INIT.md` (repo root). None of it overrides `docs/architecture.md`'s "one app, one widget" rule. Read that file first; treat this one as a menu to pick from later, not a spec to implement.

**Important**: `.idea/full-conversation.md` describes an earlier, much bigger vision — a full widget *platform* with a manifest-free discovery convention (any `.tsx` in a `widgets/` folder auto-registers), a plugin SDK, multi-display "placement engine" that treats widgets as position-independent nodes, and a native tiling layout system. That direction was explicitly rejected — this app is one widget at a time, hand-edited in `App.tsx`. Don't resurrect that architecture piecemeal by building toward it feature-by-feature; if a real need for multiple concurrent widgets ever emerges, that's a deliberate re-architecture decision to make explicitly, not something to slide into.

## Deferred for Wigl specifically (from INIT.md)

- Backlog-item counts per project (would require parsing project-internal files).
- Any parsing of project-internal files beyond git state.
- Settings UI (source directory is currently a hardcoded constant in `config.ts`).
- Sorting / multiple header actions (the reference widget had sort-by-name/npm/time; current Wigl has none).
- A "VS Code" / editor-open action alongside Finder reveal (reference widget had both; current Wigl only reveals in Finder).
- The npm:deploy-gated three-state badge from the original Übersicht widget (deliberately dropped in favor of a simpler always-checked two-real-state + error scheme).

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
- Cross-platform support beyond macOS (Wigl's window behavior is macOS-only by design; INIT.md is explicit about this).
