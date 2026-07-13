# wigl — agent guide

Tauri 2 + React 19 + TypeScript + Tailwind 4 macOS desktop-widget app. **A widget is one folder** (`src/widgets/<name>/index.tsx`, default export) — auto-discovered at build time, each rendered in its own OS window. `ls src/widgets/` for the current set; "wigl" is the app's name, never a widget's.

Use bun (`bun install`, `bun run tauri dev`), never npm/yarn/pnpm.

## Docs are intent-only, by design

`docs/` explains the contracts and the reasoning; it deliberately never enumerates which widgets or shared helpers currently exist — those lists go stale in a day. The source is the inventory: `ls src/widgets/` for widgets, `src/wigl/index.ts` (the `@/wigl` barrel) for everything shared. To see any pattern *in action*, open the most similar existing widget folder and read it top to bottom — that's the intended workflow, not a docs gap. **Don't add widget lists, helper inventories, or per-widget examples to `docs/` — keep them agnostic.**

## Read only what your task needs

| Task | Read first | Usually touch |
|------|-----------|---------------|
| Small tweak to an existing widget (UI, sorting, labels, icons) | nothing else | `src/widgets/<name>/index.tsx` |
| Change what data a widget shows / how it's fetched | `docs/architecture.md` → "Data flow pattern" | the widget's `use<Name>.ts` hook and `<name>.config.ts` |
| Add a new widget | `docs/widgets.md` (all of it), then read one existing widget folder | a new `src/widgets/<name>/` folder — that's the only edit |
| Add a UI primitive (dialog, select, ...) | `docs/widgets.md` → "Styling" | `bunx shadcn@latest add @coss/<component>` → `src/components/ui/` |
| Run a new shell command / CLI from a widget | `docs/widgets.md` → "Running shell commands" | `src-tauri/capabilities/default.json` + the widget's hook |
| Window behavior (drag, transparency, chrome, spawning) | `docs/architecture.md` → "The rule" + "What's actually shared" | `src/App.tsx` (spawner), `src/wigl/` |
| Something silently does nothing / builds look stale / can't verify visually | `docs/debugging.md` (all of it — short, saves hours) | — |
| Feature idea, scope question, "should we add X?" | `docs/future-ideas.md` + `docs/architecture.md` → "The rule" | — |
| Known defect / ceiling / pending decision | `backlog.md` | — |

## Hard rules (violating these is the main way to fail here)

1. A widget is a folder: `src/widgets/<name>/index.tsx` has exactly one export — a default-exported component — passing grid size/position as plain props to `<Widget w h col row>` from `@/wigl`. Discovery is Vite's build-time `import.meta.glob` in `src/App.tsx` — folder name = window label. Adding/removing a widget touches only its own folder: no registry file, no manifest, no `tauri.conf.json` edit, no runtime widget switching. Don't name a folder `main` (reserved for the hidden bootstrap window) or `wigl` (the app's name).
2. Shared components follow the shadcn philosophy: owned code, children + `className`, no prop-per-feature APIs. Nothing new becomes "shared" until a second widget concretely needs it. Everything shared lives in `src/wigl/` and is imported from the `@/wigl` barrel — the barrel file is the authoritative list of what's shared; widgets never deep-import wigl internals. The header component is a drag handle only — interactive children just work; use `data-no-drag` for custom clickable elements, never `stopPropagation` workarounds.
3. Data comes from shell commands (`tauri-plugin-shell`), not custom Rust. New Rust logic requires the operation to be impossible via shell.
4. macOS only. No performance work without measuring first. If a task can't be tied to a real feature in one sentence, skip it and note it. Widgets are already isolated by window (separate JS realms sharing one bundle), so cross-widget render/perf coupling isn't a thing that can happen — don't build for it.
5. Never use `dangerouslySetInnerHTML` in a widget — CSP is disabled (`csp: null`), so any injected markup runs with full IPC access. React's default escaping is the safety layer; keep it in the loop.

## Verify before claiming done

Quick: `bun run typecheck`, then `bun run build`. Full app: `bun run verify` — builds the debug `.app`, kills any stale instance, relaunches, lists the actual OS windows (`scripts/winlist.swift`), and greps the unified log for errors. `bun run kill` stops the app. Screenshots are unreliable here; `docs/debugging.md` has the full verification playbook, including the stale-bundle trap after mid-build edits.

**After finishing any feature-sized request** (new/changed widget behavior, not a one-line tweak): end the turn by running `bun run verify` yourself, not just typecheck/build. The owner needs a freshly built, freshly relaunched app to visually QA — leaving a stale build running is the same as not finishing the task. Don't wait to be asked.

New debug/CLI scripts (widget data scanners, seed scripts, anything you'd otherwise inline as a big shell string) go in `scripts/` and get a one-line `package.json` entry, same shape as `calendar:add`/`calendar:list`/`calendar:rm` and `repos:scan` — keeps `package.json` a thin index instead of growing embedded logic.

## History

The original build spec lives at `.idea/INIT.md` (fulfilled, kept for rationale); `.idea/full-conversation.md` is early exploration describing a rejected platform-scale design — don't build toward it. `.idea/` is the owner's gitignored backup/reference folder, not code — the docs must (and do) stand alone without it.
