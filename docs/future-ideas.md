# Future ideas

Raw, unapproved concepts — things we're not sure we want yet, not a spec to
implement. Once an idea is actually decided and built, its reasoning lives
in the `docs/*.md` file that owns that ground truth (see `AGENTS.md`'s
table) and its history lives in git — it comes out of this file, it doesn't
stay here with a strikethrough. Known defects and technical ceilings in
what already exists live in `backlog.md`, not here.

`.idea/full-conversation.md` (gitignored) describes an earlier, much bigger
vision than what actually got built — a full widget *platform* with a
plugin SDK, a multi-display "placement engine," and a native tiling layout
system. Most of that stays rejected: no placement engine, no native tiling
(the OS window manager is the layout engine — see `docs/architecture.md`).
Don't resurrect either piecemeal by building toward them feature-by-feature.

## Explicitly out of scope

- **Widget distribution beyond a local folder.** Cloud sync, a
  hosted marketplace/registry, or installing a widget from a URL — installs
  are local-folder only (`docs/widgets.md`). No trigger to revisit; this is
  a standing scope boundary, not a deferred feature.
- **Repos widget, from the original build spec**: backlog-item counts per
  project or any parsing of project-internal files beyond git state; the
  npm:deploy-gated three-state badge from the original Übersicht widget —
  dropped in favor of a simpler always-checked two-real-state + error
  scheme.

## Ideas worth considering if/when they become real needs

- **Global widget/theme config as a JSON editor.** A live-updating JSON
  editor for global state (theme knobs, other cross-widget config) instead
  of bespoke settings UI per surface. Unresearched — no concrete shape yet
  for what belongs in it beyond theme, or how "semi-live" updates would
  work against `useStorage`'s poll-based sync. Trigger: a second piece of
  global config shows up that would otherwise need its own settings popover.
- **Agent-authored widgets: a permission gate for unattended writes.**
  Creating a widget folder is mechanically identical whether a human or an
  agent does it — nothing new needed there. What's missing is a policy for
  what an agent may do *unattended* once it has file-write access to this
  repo: a binary auto-execute-vs-human-approval split per operation, not a
  configurable policy system. Day-one shape: writing/overwriting widget
  source, running arbitrary shell, `sqlite3` DDL/writes, and package
  installs all require a human click before they run; read-only operations
  (listing/reading the widgets dir) don't. Pair with a small secret-path
  deny-list (`.env*`, `.ssh/`, `.git/`, credential files) before they ever
  reach the approval prompt. Trigger: an actual agent-driven write flow gets
  built, not before.
- **A generalized `wigl <widget> <cmd>` CLI dispatcher.** Today a widget's
  own CLI (e.g. `wigl-widgets/calendar/cli.ts`) is invoked with
  `bun run --cwd wigl-widgets/<name> <script>` — correct (the widget owns
  its scripts, root `package.json` stays a thin index), but more to type
  than a flat `calendar:add` used to be. A generalized `scripts/wigl.ts`
  command could dispatch `wigl <widget> <cmd> [args]` by reading that
  widget's `package.json` scripts (or a small `wigl.commands` convention)
  and shelling out to it. Trigger: a second widget wants its own CLI and the
  `--cwd` typing becomes an actual friction point, not before.
- **Settings UI for the right-click global menu's scope.** The global-
  commands menu is scoped to a widget's header (`data-widget-header`)
  rather than its whole body today, so right-clicking inside a widget (e.g.
  a textarea) gets the normal context menu. Floated once: move this into an
  app-level settings surface instead of a fixed scoping rule. Not built —
  there's no native app menu bar today (the overlay flow is deliberately
  chrome-less per monitor), and a settings-driven scope is more surface than
  the concrete friction (can't paste in a widget) needs. Trigger: header-
  only scoping turns out to be wrong for some widget in practice.
- **Local-agent status widget.** Came up in a brainstorm about reducing
  dependence on cloud coding agents (Ollama, local orchestration tools).
  Conclusion so far: wigl's window model (a grid tile inside a per-monitor
  click-through overlay) is the wrong shape to *be* the orchestration UI —
  that needs a focused window with long transcripts, diff review, session
  history, none of which fit a widget tile — so build/evaluate a local-agent
  system as its own thing first, outside this repo. The one piece that
  *would* fit wigl once such a system exists to observe: a small status
  widget showing the local agent fleet — running sessions per repo, last
  tool call, elapsed time, click to focus a terminal — driven by shelling
  out to whatever CLI the chosen tool exposes, same data-flow pattern every
  other widget already uses. Trigger: a local-agent CLI is actually in daily
  use and a glanceable dashboard for it is wanted.
