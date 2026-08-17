# wigl — agent guide

Tauri 2 + React 19 + TypeScript + Tailwind 4 desktop-widget app, targeting macOS and Linux (Ubuntu; other distros expected but untested) — see `docs/architecture.md` for how the two window flows (desktop-overlay vs. windowed) differ per platform/session. **A widget is one folder** (`wigl-widgets/<name>/index.tsx`, default export — no other file required) — every widget is built and shipped through the plugin mechanism, discovered at startup off disk and laid out as a grid item inside whichever monitor's window it's assigned to (a widget is not its own OS window — see `docs/architecture.md`). `ls wigl-widgets/` for the current set; "wigl" is the app's name, never a widget's.

Use bun (`bun install`, `bun run tauri dev`), never npm/yarn/pnpm.

## Docs are intent-only, by design

`docs/` explains the contracts and the reasoning; it deliberately never enumerates which widgets or shared helpers currently exist — those lists go stale in a day. The source is the inventory: `ls wigl-widgets/` for widgets, `src/wigl/index.ts` (the `@/wigl` barrel) for everything shared. To see any pattern *in action*, open the most similar existing widget folder and read it top to bottom — that's the intended workflow, not a docs gap. **Don't add widget lists, helper inventories, or per-widget examples to `docs/` — keep them agnostic.**

Same reasoning applies to mechanism, not just inventories: describe invariants and point at the file that implements them (`src/wigl/Desktop.tsx`, `src-tauri/src/lib.rs`, ...) rather than pasting code or algorithms into a doc. A quoted snippet goes stale the moment the code it was copied from changes; a pointer to the file stays valid even after a rewrite.

## Keep docs honest

Each `docs/*.md` file owns one slice of ground truth. When a change in this session moves that ground truth — a rewritten subsystem, a removed dependency/plugin, a renamed contract — **update the owning file before ending the session**, in the same change. A doc that still reads as current fact after the code moved past it is worse than no doc; don't leave it for later.

| File | Owns |
|------|------|
| `docs/architecture.md` | The window/process model: how many OS windows exist, what runs in Rust vs. JS, how click-through and drag work |
| `docs/widgets.md` | The widget folder contract: what files a widget can have, how it's discovered, storage/query/shell conventions, and the plugin build/install mechanism (folder/package.json shape, build/install CLI, the host module registry, the permission model) |
| `docs/debugging.md` | How to verify a change and diagnose the current failure modes |
| `docs/future-ideas.md` | Product ideas and closed/rejected scope decisions — defects and open gaps go in `backlog.md` instead |
| `docs/principles.md` | Code-shape and file-organization rules (functional core / imperative shell, 80/20 file focus, naming) — short on purpose |
| `docs/theming.md` | The theme token contract, preset vs. parametric generation, and the no-hardcoded-color rule for widgets |
| `docs/testing.md` | The `./tests` layout, how to write a test per tier, and how to mock storage/host modules |

If a task's outcome doesn't change any of those claims, there's nothing to update — most small tweaks won't.

## Read only what your task needs

| Task | Read first | Usually touch |
|------|-----------|---------------|
| Small tweak to an existing widget (UI, sorting, labels, icons) | nothing else | `wigl-widgets/<name>/index.tsx`, then `bun run widget:install wigl-widgets/<name>` |
| Change what data a widget shows / how it's fetched | `docs/architecture.md` → "Data flow pattern" | the widget's `use<Name>.ts` hook and `<name>.config.ts` |
| Add a new widget | `docs/widgets.md` (all of it), then read `wigl-widgets/calendar/` | a new `wigl-widgets/<name>/` folder — that's the only edit |
| Change what a widget may import or which capability it needs | `docs/widgets.md` → "Build, install, and the plugin mechanism" | `src/wigl/plugins/host-modules.ts` + `registry.ts` |
| Add a UI primitive (dialog, select, ...) | `docs/widgets.md` → "Styling" | `bunx shadcn@latest add @coss/<component>` → `src/components/ui/` |
| Run a new shell command / CLI from a widget | `docs/widgets.md` → "Running shell commands" | `src-tauri/capabilities/default.json` + the widget's hook |
| Window/monitor behavior (drag, transparency, chrome, click-through) | `docs/architecture.md` (all of it) | `src/wigl/Desktop.tsx`, `src-tauri/src/lib.rs` |
| Something silently does nothing / builds look stale / can't verify visually | `docs/debugging.md` (all of it — short, saves hours) | — |
| Rendering/perf bug that only happens on one machine | `docs/debugging.md` → "Diagnosing a 'only happens on my machine' rendering bug", then run `tests/manual/x11-report.py` | — |
| Feature idea, scope question, "should we add X?" | `docs/future-ideas.md` + `docs/architecture.md` → "The rule" | — |
| Known defect / ceiling / pending decision | `backlog.md` | — |
| Fixed a core bug / landed a core feature yourself, in the moment | this file's "Testing" section | `tests/backlog.md` (append, don't write the test) |
| Explicitly asked to write tests (for a bug/feature/queue entry) | this file's "Testing" section + `docs/testing.md` | `tests/*.test.ts` (core-only, ~20% bar — zero new tests is a valid outcome) |

## Hard rules (violating these is the main way to fail here)

1. A widget is a folder — `wigl-widgets/<name>/`, no config file required — with exactly one export from `index.tsx`: a default-exported component that renders a `<Widget w h col row>` from `@/wigl` as its root (enforced at `bun run widget:check`, not just convention). Folder name = widget id, always — nothing else declares it. An optional `package.json` adds npm dependencies, permissions (`wigl.permissions`), or a custom entry path (`main`) — see `docs/widgets.md`. Rendered as a grid item by whichever monitor's `<Desktop>` owns it (see `docs/architecture.md`). Built and installed by `bun run widget:install`. Adding/removing a widget touches only its own folder: no registry file, no `tauri.conf.json` edit, no Rust edit. Don't name a folder `main` (reserved for the hidden bootstrap window) or `wigl` (the app's name).
   - A widget imports React and everything shared through the host module registry (`src/wigl/plugins/host-modules.ts`), never its own copy, and never `@tauri-apps/*` directly. Needing something the registry doesn't serve means adding a host module — not an escape hatch. Anything else it needs, it bundles.
2. Shared components follow the shadcn philosophy: owned code, children + `className`, no prop-per-feature APIs. Nothing new becomes "shared" until a second widget concretely needs it. Everything shared lives in `src/wigl/` behind exactly three barrels — visual/layout primitives from `@/wigl`, stateful/React hooks from `@/wigl/hooks`, plain non-React helpers from `@/wigl/utils` — each barrel's `index.ts` is the authoritative list of what it exports; widgets never deep-import past those three. The header component's own content (title, buttons) is ordinary interactive/selectable content — only its small top-right grip drags the widget; use `data-no-drag` for custom clickable elements placed inside the grip itself (rare), never `stopPropagation` workarounds.
3. Data comes from shell commands (`tauri-plugin-shell`), not custom Rust. New Rust logic requires the operation to be impossible via shell.
4. macOS and Linux (Ubuntu) only — no Windows — for the app itself: the GUI (window chrome, drag, click-through, `src-tauri/src/lib.rs`, `src/wigl/Desktop.tsx`) and `bun run verify`/`qa` (shell scripts). The widget **authoring/build tooling** (`scripts/widget.ts`'s `build`/`install`/`check`/`devkit`/etc., and the `tests/e2e/` suite that exercises it) is plain Bun/TypeScript with no shell scripts or macOS/Linux-only APIs, and is expected to work on Windows too — see `tests/e2e/README.md`'s "Platform scope". Don't read this as a broader Windows-support decision; it isn't one. No performance work without measuring first. If a task can't be tied to a real feature in one sentence, skip it and note it. Widgets sharing a monitor share one JS realm and React tree (each monitor is its own window/realm, not each widget) — a per-widget error boundary in `Desktop.tsx` stops one widget's crash from taking down the others on that screen, but don't assume render isolation between widgets the way separate windows would give you.
5. Never use `dangerouslySetInnerHTML` in a widget — CSP is disabled (`csp: null`), so any injected markup runs with full IPC access. React's default escaping is the safety layer; keep it in the loop.

## Verify before claiming done

Quick: `bun run typecheck`, then `bun run build`. Full app: `bun run verify` (`scripts/verify.sh`, branches on `uname`) — builds the debug app, kills any stale instance, relaunches, checks it's actually up (macOS: lists the OS windows via `scripts/winlist.swift`; Linux: process liveness + captured log, see `docs/debugging.md`'s "Verifying on Linux"), and greps for errors. `bun run kill` stops the app. Screenshots are unreliable here; `docs/debugging.md` has the full verification playbook, including the stale-bundle trap after mid-build edits.

**After finishing any feature-sized request** (new/changed widget behavior, not a one-line tweak): end the turn by running `bun run verify` yourself, not just typecheck/build. The owner needs a freshly built, freshly relaunched app to visually QA — leaving a stale build running is the same as not finishing the task. Don't wait to be asked.

For the owner's own fast build-and-look iteration (not for the agent to run unprompted), `bun run qa` / `bun run qa:app` (`scripts/qa.sh`) skip packaging and `verify`'s window/log checks — `qa` auto-detects overlay vs. windowed mode the same way the app itself does (see `docs/architecture.md`), `qa:app` forces windowed mode everywhere so both flows are QA-able on one machine.

New debug/CLI scripts that operate on the whole repo (widget data scanners, seed scripts, anything you'd otherwise inline as a big shell string) go in `scripts/` and get a one-line root `package.json` entry, same shape as `tw-colors`/`check:eager`. A script that only makes sense for one widget (e.g. the calendar CLI) lives inside that widget's own folder instead, with its own `scripts` entry in *that* folder's `package.json` (invoked as `bun run --cwd wigl-widgets/<name> <script>`) — root `package.json` stays a thin index of repo-wide commands, not a registry of every widget's tooling.

## Testing

Everything test-related lives under `./tests` — see `docs/testing.md` for
the layout, how to write a test per tier, and how to mock storage/host
modules. This section is the policy, not the mechanics.

**Core only** — `src/wigl` (grid math, drag/reflow, hooks, the plugin
registry/permission gating) — never an individual widget's own logic. A
widget's own bugs get colocated coverage in its own `tests/` folder if it
wants any (already the convention — see `wigl-widgets/LocalCode/tests/`),
but that's the widget author's call, not this file's rule. And not every
core bug becomes a test either — only a real defect in shared surface
everything depends on, and once fixed, tracked as one queue entry (see
below), not a test written reflexively per commit.

**This is deliberately not full coverage.** The bar is roughly 20% of the
surface covering the 80% that actually breaks things — real invariants and
algorithms (grid math, the drag/reflow reducer, a coordinate correction,
permission gating), not thin React wiring, prop-drilling, or anything
`bun run typecheck`/`build` already catches. Given a task to write tests —
for a bug just fixed, a feature just landed, or a direct "write tests for
what you just built" ask — the correct output is sometimes zero new tests
(say so, and why, instead of forcing one to exist), sometimes one new
`expect()` added to an existing file instead of a new one. Never pad a pass
with coverage for code that isn't a shared invariant just to have something
to show.

**Two different requests, two different behaviors — don't conflate them:**
- **Fixing/landing something yourself, in the moment:** don't write the
  test — append one entry to `tests/backlog.md` (see below) and move on.
  Keeps the fix's own commit small.
- **Explicitly asked to write tests** (for a bug, a feature, "what you just
  implemented," or a queue entry) — write real test(s) directly, right now,
  same file. Still core-only, still the 20%-bar above; check
  `tests/backlog.md` for entries this closes, and delete any that do.

A **real OS cursor** (`cliclick` on macOS, the X11 harness on Linux —
`tests/manual/`) stays manual, never part of `bun run test`. It needs
OS-level permissions granted by a human, and is genuinely flaky against
window occlusion and click-through-poller timing (see commit `0f792ec`'s
cross-monitor-drag fix in git history for exactly how flaky, and what it
took to get a clean live repro) — it can prove "this works on this machine
right now," not gate a commit. Never run anything in `tests/manual/`
unprompted — it can tie up the owner's real cursor/machine for as long as
it runs.

Reference a specific bug by **commit hash**, not by backlog ticket id, in
anything meant to outlive the fix (a test's name/comments, a manual
script) — a ticket like "B8" gets deleted from `backlog.md` the moment
it's resolved (that file's own rule), so a name or comment that only makes
sense by cross-referencing it goes stale silently. `git log`/`git show
<hash>` always resolves; a ticket id doesn't.

A separate, periodic pass (an agent, a subagent it spawns, or a human) is
what normally turns `tests/backlog.md` queue entries into real tests — see
"Two different requests" above for when to queue vs. when to write
directly.

`bun run test` runs everything safe (core + `tests/e2e` + every widget's
own tests); `bun run test:e2e` / `bun run test:widgets` isolate one slice —
see `scripts/wigl.ts`.

## Working tips

- **Evaluating an unfamiliar library or CLI tool?** Clone it into `.idea/`
  (the owner's gitignored reference folder — see "History" below) rather
  than guessing at its API from memory or a half-remembered blog post. Read
  its actual README, and skim the source for the feature you care about,
  before writing code against it. `.idea/` already exists for exactly this
  ("backup/reference folder, not code") — a cloned repo for research fits
  the same role a saved spec document does.
- **Testing a flow by hand, more than once?** Put the script in
  `tests/manual/` (bash/python/AppleScript/whatever fits — see its own
  README) instead of re-typing a shell one-liner from scratch each time or
  writing a full automated test for something that doesn't need one. This is
  for manual QA loops ("does drag still work", "does the composer still
  stream"), not CI — a lightweight, rerunnable, predictable way to check
  something without the overhead of a real test suite.
- **Scripting real mouse/keyboard input?** It moves the owner's actual
  cursor and makes the machine unusable while it runs. `tests/manual/`'s
  README has the rules (hard 60s budget, enforced in `ghost-probe.py`; never
  background one; never "wait for it to crash"). Read them before writing
  anything that drives XTest.
- **Installing something globally** (not into this repo's own
  `node_modules`) **to make a widget or script work?** Add a line to
  `global-deps.md` — what it is, how it's installed, what depends on it.
  That's what makes "can this be uninstalled" and "is there already
  something on this machine for X" answerable later instead of guesswork.
- **Writing documentation**: default to extending this file or the relevant
  `docs/*.md` owner (see the table above), not creating a new doc file. Too
  many docs, or too much upfront architecture, is often more confusing than
  helpful — a new file is one more place for ground truth to go stale
  unnoticed. Keep it to the basics that actually save the next reader time.
- **Commit after finishing a major change**, not just at the very end of a
  long session. Small, real checkpoints mean nothing is ever lost and any
  step can be backtracked to if a later one goes wrong — don't let a long
  session accumulate into one uncommitted pile.
- **Hit something genuinely blocking** — a real ambiguity, a decision only
  the owner can make, something that looks impossible given the constraints
  here? **Stop and ask**, rather than guessing, working around it silently,
  or spinning on the same approach repeatedly. Minimize wasted effort: a
  clarifying question costs one round-trip; a wrong guess acted on costs
  the time to notice it, explain why it was wrong, and redo the work.

## History

The original build spec lives at `.idea/INIT.md` (fulfilled, kept for rationale); `.idea/full-conversation.md` is early exploration describing a rejected platform-scale design — don't build toward it. `.idea/` is the owner's gitignored backup/reference folder, not code — the docs must (and do) stand alone without it.
