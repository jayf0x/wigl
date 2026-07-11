# wigl — agent guide

Tauri 2 + React 19 + TypeScript + Tailwind 4 macOS desktop-widget app. **A widget is one folder** (`src/widgets/<name>/index.tsx`, default export) — auto-discovered at build time, each rendered in its own OS window. Currently: `repos` (repo-status panel) and `todo` (placeholder). "wigl" is the app's name, not a widget's.

Use bun (`bun install`, `bun run tauri dev`), never npm/yarn/pnpm.

## Read only what your task needs

| Task | Read first | Usually touch |
|------|-----------|---------------|
| Small tweak to an existing widget (UI, sorting, labels, icons) | nothing else | `src/widgets/<name>/index.tsx` |
| Change what data a widget shows / how it's fetched | `docs/architecture.md` → "Data flow pattern" | `src/widgets/<name>/use<Name>Widget.ts`, `src/widgets/<name>/<name>Widget.config.ts` |
| Add a new widget | `docs/widgets.md` (all of it) | a new `src/widgets/<name>/` folder — that's the only edit |
| Add a UI primitive (dialog, select, ...) | `docs/widgets.md` → "Styling" | `bunx shadcn@latest add @coss/<component>` → `src/components/ui/` |
| Run a new shell command / CLI from a widget | `docs/widgets.md` → "Running shell commands" | `src-tauri/capabilities/default.json` + the widget's hook |
| Window behavior (drag, transparency, chrome, spawning) | `docs/architecture.md` → "The rule" + "What's actually shared" | `src/App.tsx` (spawner), `src/wigl/` |
| Something silently does nothing / builds look stale / can't verify visually | `docs/debugging.md` (all of it — short, saves hours) | — |
| Feature idea, scope question, "should we add X?" | `docs/future-ideas.md` + `docs/architecture.md` → "The rule" | — |

## Hard rules (violating these is the main way to fail here)

1. A widget is a folder: `src/widgets/<name>/index.tsx` default-exports the component, optionally exports `windowConfig`. Discovery is Vite's build-time `import.meta.glob` in `src/App.tsx` — folder name = window label. Adding/removing a widget touches only its own folder: no registry file, no manifest, no `tauri.conf.json` edit, no runtime widget switching. Don't name a folder `main` (reserved for the hidden bootstrap window).
2. Shared components follow the shadcn philosophy: owned code, children + `className`, no prop-per-feature APIs. Nothing new becomes "shared" until a second widget concretely needs it. Everything shared lives in `src/wigl/` and is imported from the `@/wigl` barrel — today: `Widget`/`WidgetHeader` (panel chrome), `drag.ts`, plus the window-state plugin. `WidgetHeader` is a drag handle only — interactive children just work; use `data-no-drag` for custom clickable elements, never `stopPropagation` workarounds.
3. Data comes from shell commands (`tauri-plugin-shell`), not custom Rust. New Rust logic requires the operation to be impossible via shell.
4. macOS only. No performance work without measuring first. If a task can't be tied to a real feature in one sentence, skip it and note it. Widgets are already isolated by window (separate JS realms sharing one bundle), so cross-widget render/perf coupling isn't a thing that can happen — don't build for it.

## Verify before claiming done

Quick: `bun run typecheck`, then `bun run build`. Full app: `bun run verify` — builds the debug `.app`, kills any stale instance, relaunches, lists the actual OS windows (`scripts/winlist.swift`), and greps the unified log for errors. `bun run kill` stops the app. Screenshots are unreliable here; `docs/debugging.md` has the full verification playbook, including the stale-bundle trap after mid-build edits.

## History

The original build spec lives at `.idea/INIT.md` (fulfilled, kept for rationale); `.idea/full-conversation.md` is early exploration describing a rejected platform-scale design — don't build toward it. `.idea/` is gitignored reference material, not code.
