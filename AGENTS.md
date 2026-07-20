# wigl — agent guide

Tauri 2 + React 19 + TypeScript + Tailwind 4 desktop-widget app, targeting macOS and Linux (Ubuntu; other distros expected but untested) — see `docs/architecture.md` for how the two window flows (desktop-overlay vs. windowed) differ per platform/session. **A widget is one folder** (`src/widgets/<name>/index.tsx`, default export) — auto-discovered at build time and laid out as a grid item inside whichever monitor's window it's assigned to (a widget is not its own OS window — see `docs/architecture.md`). `ls src/widgets/` for the current set; "wigl" is the app's name, never a widget's.

Use bun (`bun install`, `bun run tauri dev`), never npm/yarn/pnpm.

## Docs are intent-only, by design

`docs/` explains the contracts and the reasoning; it deliberately never enumerates which widgets or shared helpers currently exist — those lists go stale in a day. The source is the inventory: `ls src/widgets/` for widgets, `src/wigl/index.ts` (the `@/wigl` barrel) for everything shared. To see any pattern *in action*, open the most similar existing widget folder and read it top to bottom — that's the intended workflow, not a docs gap. **Don't add widget lists, helper inventories, or per-widget examples to `docs/` — keep them agnostic.**

Same reasoning applies to mechanism, not just inventories: describe invariants and point at the file that implements them (`src/wigl/Desktop.tsx`, `src-tauri/src/lib.rs`, ...) rather than pasting code or algorithms into a doc. A quoted snippet goes stale the moment the code it was copied from changes; a pointer to the file stays valid even after a rewrite.

## Keep docs honest

Each `docs/*.md` file owns one slice of ground truth. When a change in this session moves that ground truth — a rewritten subsystem, a removed dependency/plugin, a renamed contract — **update the owning file before ending the session**, in the same change. A doc that still reads as current fact after the code moved past it is worse than no doc; don't leave it for later.

| File | Owns |
|------|------|
| `docs/architecture.md` | The window/process model: how many OS windows exist, what runs in Rust vs. JS, how click-through and drag work |
| `docs/widgets.md` | The widget folder contract: what files a widget can have, how it's discovered, storage/query/shell conventions |
| `docs/debugging.md` | How to verify a change and diagnose the current failure modes |
| `docs/future-ideas.md` | Product ideas and closed/rejected scope decisions — defects and open gaps go in `backlog.md` instead |
| `docs/principles.md` | Code-shape rules (functional core / imperative shell) — short on purpose |

If a task's outcome doesn't change any of those five claims, there's nothing to update — most small tweaks won't.

## Read only what your task needs

| Task | Read first | Usually touch |
|------|-----------|---------------|
| Small tweak to an existing widget (UI, sorting, labels, icons) | nothing else | `src/widgets/<name>/index.tsx` |
| Change what data a widget shows / how it's fetched | `docs/architecture.md` → "Data flow pattern" | the widget's `use<Name>.ts` hook and `<name>.config.ts` |
| Add a new widget | `docs/widgets.md` (all of it), then read one existing widget folder | a new `src/widgets/<name>/` folder — that's the only edit |
| Add a UI primitive (dialog, select, ...) | `docs/widgets.md` → "Styling" | `bunx shadcn@latest add @coss/<component>` → `src/components/ui/` |
| Run a new shell command / CLI from a widget | `docs/widgets.md` → "Running shell commands" | `src-tauri/capabilities/default.json` + the widget's hook |
| Window/monitor behavior (drag, transparency, chrome, click-through) | `docs/architecture.md` (all of it) | `src/wigl/Desktop.tsx`, `src-tauri/src/lib.rs` |
| Something silently does nothing / builds look stale / can't verify visually | `docs/debugging.md` (all of it — short, saves hours) | — |
| Feature idea, scope question, "should we add X?" | `docs/future-ideas.md` + `docs/architecture.md` → "The rule" | — |
| Known defect / ceiling / pending decision | `backlog.md` | — |

## Hard rules (violating these is the main way to fail here)

1. A widget is a folder: `src/widgets/<name>/index.tsx` has exactly one export — a default-exported component — passing grid size/position as plain props to `<Widget w h col row>` from `@/wigl`. Discovery is Vite's build-time `import.meta.glob` in `src/App.tsx` — folder name = widget id, rendered as a grid item by whichever monitor's `<Desktop>` owns it (see `docs/architecture.md`). Adding/removing a widget touches only its own folder: no registry file, no manifest, no `tauri.conf.json` edit, no Rust edit. Don't name a folder `main` (reserved for the hidden bootstrap window) or `wigl` (the app's name).
2. Shared components follow the shadcn philosophy: owned code, children + `className`, no prop-per-feature APIs. Nothing new becomes "shared" until a second widget concretely needs it. Everything shared lives in `src/wigl/` and is imported from the `@/wigl` barrel — the barrel file is the authoritative list of what's shared; widgets never deep-import wigl internals. The header component is a drag handle only — interactive children just work; use `data-no-drag` for custom clickable elements, never `stopPropagation` workarounds.
3. Data comes from shell commands (`tauri-plugin-shell`), not custom Rust. New Rust logic requires the operation to be impossible via shell.
4. macOS and Linux (Ubuntu) only — no Windows. No performance work without measuring first. If a task can't be tied to a real feature in one sentence, skip it and note it. Widgets sharing a monitor share one JS realm and React tree (each monitor is its own window/realm, not each widget) — a per-widget error boundary in `Desktop.tsx` stops one widget's crash from taking down the others on that screen, but don't assume render isolation between widgets the way separate windows would give you.
5. Never use `dangerouslySetInnerHTML` in a widget — CSP is disabled (`csp: null`), so any injected markup runs with full IPC access. React's default escaping is the safety layer; keep it in the loop.

## Verify before claiming done

Quick: `bun run typecheck`, then `bun run build`. Full app: `bun run verify` (`scripts/verify.sh`, branches on `uname`) — builds the debug app, kills any stale instance, relaunches, checks it's actually up (macOS: lists the OS windows via `scripts/winlist.swift`; Linux: process liveness + captured log, see `docs/debugging.md`'s "Verifying on Linux"), and greps for errors. `bun run kill` stops the app. Screenshots are unreliable here; `docs/debugging.md` has the full verification playbook, including the stale-bundle trap after mid-build edits.

**After finishing any feature-sized request** (new/changed widget behavior, not a one-line tweak): end the turn by running `bun run verify` yourself, not just typecheck/build. The owner needs a freshly built, freshly relaunched app to visually QA — leaving a stale build running is the same as not finishing the task. Don't wait to be asked.

For the owner's own fast build-and-look iteration (not for the agent to run unprompted), `bun run qa` / `bun run qa:app` (`scripts/qa.sh`) skip packaging and `verify`'s window/log checks — `qa` auto-detects overlay vs. windowed mode the same way the app itself does (see `docs/architecture.md`), `qa:app` forces windowed mode everywhere so both flows are QA-able on one machine.

New debug/CLI scripts (widget data scanners, seed scripts, anything you'd otherwise inline as a big shell string) go in `scripts/` and get a one-line `package.json` entry, same shape as `calendar:add`/`calendar:list`/`calendar:rm` and `repos:scan` — keeps `package.json` a thin index instead of growing embedded logic.

## History

The original build spec lives at `.idea/INIT.md` (fulfilled, kept for rationale); `.idea/full-conversation.md` is early exploration describing a rejected platform-scale design — don't build toward it. `.idea/` is the owner's gitignored backup/reference folder, not code — the docs must (and do) stand alone without it.
