# LocalCode — design sketch (not implemented)

Status: research complete, zero code written. This file is the only thing in
this folder on purpose — it's a scratch memory dump so a future session (or
future you) doesn't have to re-derive the research. Delete or promote when
we actually build this.

## 0. The one decision this doc has to make first

`docs/future-ideas.md`'s "Local-agent status widget" entry already looked at
this exact idea and landed on: **a full chat/transcript/diff-review UI does
not fit wigl's shape** (grid tile inside a per-monitor overlay — no long
scrollback, no focused window, no OS-level chrome). Its recommendation was a
glanceable *status* widget only: running sessions per repo, last tool call,
elapsed time, click-to-focus-a-terminal.

The prompt that spawned this sketch explicitly asks for a Claude-Code-like
chat flow (sidebar + central session panel + reasoning display). That's a
real tension, not a rounding error. Reconciled as follows:

**Build two things, not one, and only build the first now:**

1. **LocalCode-lite (the actual near-term build target)**: a session
   *dashboard* widget, per the future-ideas conclusion. Sidebar-shaped list
   of sessions (across opencode + Claude Code), status/last-tool-call/elapsed
   time, rename, pin-to-top. Sending a new prompt or reading full transcript
   happens by focusing an external terminal (`code --reuse-window`,
   `wezterm`/whatever terminal is on PATH, or literally the CLI's own `-c`/
   `--continue` in a spawned terminal) — the widget's job is *awareness and
   launch*, not hosting the chat.
2. **LocalCode-full (deferred, not this repo's problem yet)**: the actual
   Claude-Code-like chat surface — sidebar + central transcript + reasoning
   + tool-call/diff rendering — as a **separate standalone app** (own Tauri
   window or even just a browser tab), *outside* wigl's grid-tile model,
   the same way the future-ideas note says to build/evaluate local-agent
   orchestration "as its own thing first, outside this repo." If that
   separate app turns out to be worth it, wigl's role stays limited to a
   status tile that can deep-link into it.

Everything below documents research for *both* shapes, since the CLI/data
findings are shared — but if we pick up this folder again, start with
LocalCode-lite. Don't build the full chat UI as a wigl widget without
re-litigating point 0 with the owner first.

## 1. What's installed, right now, on this machine

- `opencode` v1.18.15 at `~/.bun/bin/opencode` (bun global install).
- `claude` (Claude Code CLI) v2.1.212 at `~/.bun/bin/claude`.
- Both are bun-installed, so likely **not on a GUI-launched shell's PATH**
  (same problem `wigl-widgets/repos/commands.ts` already solves for `gh`/
  editors — reuse that absolute-path-first-then-bare-name fallback pattern).

## 2. Scriptable surfaces (the actual shell-out targets)

### opencode
- `opencode run [message..] --format json -s <sessionId> --model <p/m> --variant <effort>`
  — one-shot, non-interactive, structured JSON output. `-c/--continue`,
  `--fork`, `--title` all exist. This is the natural fit for wigl's
  "one-shot shell command" data-flow pattern.
- `opencode serve --port <n>` — headless HTTP server, long-lived. Bigger
  departure from wigl's pattern (no widget today supervises a background
  daemon); `opencode run --attach http://localhost:PORT` can reuse one if
  we ever want lower per-turn latency. Not needed for LocalCode-lite.
- `opencode session list --format json`, `opencode session delete <id>`,
  `opencode export [sessionID] [--sanitize]`, `opencode import <file>`,
  `opencode models [provider]` — all one-shot, all `--format json`-able.
  `session list` + `export` alone are enough to build LocalCode-lite's
  sidebar without touching `run`/`serve` at all.
- Config dir `~/.config/opencode/` (empty on this machine). State dir
  `~/.local/share/opencode/{log,repos}/` (empty — nothing run yet during
  research, on purpose). No on-disk session file format was verified
  directly — go through `session list`/`export --format json`, don't guess
  a file layout.
- Auth (`opencode auth login/logout`, `opencode providers`) is entirely
  CLI-managed — LocalCode assumes the user already ran this themselves,
  same as wigl assumes `gh auth login` already happened for the repos widget.

### claude (Claude Code CLI)
- `claude -p --output-format stream-json --input-format stream-json` — full
  duplex streaming protocol, good fit for a persistent subprocess piped
  turn-by-turn (closer to a "keep one process alive per session" model than
  opencode's per-invocation `run`).
- `-r/--resume [id]`, `-c/--continue`, `--fork-session`, `--session-id`,
  `-n/--name` (Claude Code already has manual session naming built in).
- `--model`, `--effort <low|medium|high|xhigh|max>`,
  `--permission-mode <acceptEdits|auto|bypassPermissions|manual|dontAsk|plan>`,
  `--allowedTools`/`--disallowedTools` — permission-level selector maps
  directly onto `--permission-mode`.
- `--dangerously-skip-permissions` exists but is explicitly sandbox-only —
  never wire this into a widget default.
- Session files on disk: `~/.claude/projects/<slugified-path>/<uuid>.jsonl`,
  one JSON object per line, real observed record types include `"mode"`,
  `"queue-operation"`, `"user"`/`"assistant"` transcript turns. Directly
  tailable/parseable via shell — a legit fallback for reading transcript
  history without going through `-p` at all. (Peeked at an existing
  unrelated session's structure only — no new agent turn was run to
  populate this during research.)

### Shared shape worth designing around
Both tools support: non-interactive mode, JSON/structured streaming output,
session resume/fork by ID, model + reasoning-effort selection, and a
permission-mode-style gate. A LocalCode data layer can treat "agent backend"
as a small interface (`listSessions`, `getSession`, `sendTurn`,
`resumeSession`) implemented once per CLI, rather than hard-coding either
tool's shape into the UI.

## 3. What OpenGUI actually is now (correct this if it's stale later)

**Important**: the OpenGUI checkout at `.idea/OpenGUI/` has already ripped
out its opencode/Claude-Code/Codex bridge entirely (ADR 0010, accepted —
`.idea/OpenGUI/docs/adr/0010-first-party-opengui-harness.md`). It's building
its own first-party agent harness now. So it's **not** current evidence for
"how to shell out to opencode" — for that, `.idea/OpenGUI/docs/reports/OPENCODE_REPORT.md`
(a debug report from when the bridge still existed) and section 2 above are
the real sources. OpenGUI *is* still a good reference for UI/data-model
shape:

- **Session entry log** (`packages/harness/src/harness.ts`): append-only,
  sequence-numbered `SessionEntry { id, sessionId, sequence, kind, payload,
  createdAt }`, kinds include `session_created/renamed`, `model_changed`,
  `run_started/completed/failed/interrupted`, `user_message`,
  `assistant_reasoning`, `assistant_message`, `tool_call`, `tool_result`,
  `compaction`. Streaming deltas (`assistant_delta`, `reasoning_delta`) are
  a *separate* transient event type — only finished turns get durably
  logged. Good pattern regardless of which shape we build.
- **No AI session auto-titling exists in OpenGUI** — sessions default to
  "New session," renamed manually only. If LocalCode wants the "tiny model
  summarizes first prompt into 5-20 chars" feature from the original brief,
  that's net-new, not a port. Cheapest version: don't spin up a second LLM
  call for this — just truncate/clean the first user message client-side
  (e.g. first ~40 chars, strip newlines) as the default title, same as
  `opencode run --title` already does ("uses truncated prompt if omitted").
  A real tiny-model summary is a nice-to-have, not a blocker, and adds a
  second CLI invocation + cost per new session.
- **Reasoning block rendering** (`ReasoningPartView.tsx`): collapsible,
  collapsed by default, only rendered at all if non-empty, auto-scrolls
  while streaming, shows duration once finished. Directly reusable shape
  for a compact widget tile.
- **Diff rendering** (`tools/DiffView.tsx`): inline unified diff, only
  changed lines + 2 lines of context, collapsed runs shown as `...`,
  monospace `text-[11px]`, `max-h-64 overflow-auto`. This is the right
  *size* of diff view for a grid tile — OpenGUI's own tile-sized component,
  not its full-page one.
- **Sessions are not drag-reordered** in OpenGUI — recency sort, with an
  optional per-session `sidebarMovedAt` timestamp for "bump to top." Actual
  free-form drag-and-drop (`@dnd-kit`) exists for *projects*, not sessions.
  → For the "YouTube-playlist-style separate custom sort" feature in the
  original brief: OpenGUI doesn't validate that this is needed for sessions
  specifically. Recommend starting with the cheaper `pinned_at`/bump-to-top
  pattern (store in wigl's own `useStorage`, keyed separately from the
  date-sort so date-sort never overwrites it — that part of the brief is
  right regardless of mechanism) and only reaching for `@dnd-kit` if
  bump-to-top turns out to feel wrong in practice. `@dnd-kit` is a real
  bundlable per-plugin npm dep if we do need it later (wigl plugins can
  have their own `package.json` deps).
- **Permission/execution policy** (`packages/harness/src/execution-policy.ts`):
  OpenGUI's is a multi-tenant remote-sandbox grant system. Not applicable —
  wigl already has an unrestricted local shell model; don't import this
  complexity. Use the CLI's own `--permission-mode` / `--auto` flags
  directly instead of reinventing a policy layer in the widget.

`.idea/OpenCode_UI/` (native Kotlin/Android, explicitly outdated per the
task brief) wasn't deep-read — its stack is far enough from wigl's (Tauri/
React vs. native Android) that its main residual value would be minimal-UI
ideas for a small-surface client, unverified. Low priority to revisit.

## 4. wigl mechanics this has to slot into

- One folder = one widget, `index.tsx` default-exports a component rooted
  in `<Widget w h col row>` from `@/wigl`. No manifest, folder name is the id.
- **No `@tauri-apps/*` imports ever** — only `react`, `lucide-react`,
  `@/wigl`, `@/wigl/hooks`, `@/wigl/utils`, and a fixed set of `@/components/
  ui/*` are available through the host module registry
  (`src/wigl/plugins/host-modules.ts` + `registry.ts`). **Chat-relevant
  primitives (textarea, dialog, scroll-area, markdown renderer) aren't
  registered yet** — adding LocalCode means adding these via
  `bunx shadcn@latest add @coss/<component>` and registering them, per
  `docs/widgets.md`'s host-module-addition path.
- All shell access via `runCmd`/`runCmdStreaming` from `@/wigl/utils`
  (`"command"` permission in the widget's `package.json`). Reference
  implementation to copy the *shape* of (not the content):
  `wigl-widgets/repos/commands.ts` — `sh -c "..."` with a `shQuote` helper,
  absolute-path-first-then-bare-name fallback for CLI binaries not
  guaranteed on a GUI shell's PATH, `runCmdStreaming` + line callback for
  long output (already proven for `git clone --progress`; same shape fits
  `opencode run --format json` or `claude -p --output-format stream-json`
  line-by-line). `sh` is already allow-listed for both execute and spawn in
  `src-tauri/capabilities/default.json` — no new Tauri capability needed.
- Persistence: `useStorage`/`useQuery` from `@/wigl/hooks`, one flat SQLite
  `kv` table shared across all widgets, keys must be prefixed
  (`localcode_*`). This is where LocalCode's *own* metadata layer belongs —
  pinned/custom order, edited display names, cached `session list` /
  `models` output (`useQuery` with `useSql: true` for cross-restart caching)
  — layered on top of, not replacing, whatever opencode/Claude Code already
  persist on disk themselves.
- Styling: Tailwind + semantic tokens only, no hardcoded colors, no
  `dangerouslySetInnerHTML` (CSP is disabled — a markdown renderer for
  agent output MUST escape/sanitize properly, this is a real risk surface
  given the content is LLM output the user didn't author, not a formality).
- Grid sizing has no hard ceiling (`repos` already runs `w=6 h=5`), but
  there's no existing precedent for a full transcript-sized tile — another
  point in favor of starting with the lite/dashboard shape (small tile
  reads naturally) over the full chat shape (would want to be the biggest
  tile on screen, fighting the "one of several tiles on a monitor" model).

## 5. Proposed LocalCode-lite shape (if/when we build)

- `wigl-widgets/LocalCode/index.tsx` — `<Widget w=4 h=5>` (bigger tile,
  still bounded), header "LOCALCODE".
- `useLocalCode.ts` — polls (`useQuery`, moderate `stale`, e.g. 5-10s):
  - `opencode session list --format json`
  - `claude`'s own `~/.claude/projects/<slug>/*.jsonl` dir listing (mtime +
    peek first/last line for status) as the Claude Code side, since it has
    no equivalent "list sessions" subcommand surfaced in `--help`.
  - merge into one `Session { id, backend: "opencode"|"claude", title,
    projectDir, status, updatedAt }[]` list.
- Sidebar-style list (single column, this *is* the whole tile): filter by
  name/date (client-side over the merged list, no new shell calls), pin/
  bump-to-top stored in `localcode_pinned` (`useStorage`), rename stored in
  `localcode_titles` (`useStorage`, keyed by session id — overlays the
  CLI's own title, never mutates the CLI's session file).
- Click a session → shell out to open a terminal focused on
  `opencode run -c -s <id>` or `claude -r <id>` (terminal launch command
  itself needs the same PATH-fallback treatment as `commands.ts`; exact
  terminal binary is a Linux/macOS fork — Ubuntu has no single guaranteed
  default terminal, may need a small prioritized-candidate-list like the
  `openInEditor` pattern already does for editors).
- "New session" button → same terminal-launch path with no `-s`/`-r`
  (`opencode run` / `claude` fresh).
- No inline chat, no inline reasoning/diff rendering in v1 of the lite
  widget — that's explicitly the line LocalCode-full would cross. Revisit
  only after the lite widget has been used for real and the owner still
  wants more.

## 6. Open questions to resolve before actually coding this

1. Does the owner still want the full chat surface (LocalCode-full) at all,
   given section 0's reconciliation — or is the lite dashboard sufficient?
2. Claude Code has no listed `session list` subcommand — confirm there
   isn't one before committing to "scan `~/.claude/projects/*/`.jsonl mtimes"
   as the discovery mechanism (check `claude --help` subcommands again,
   e.g. `claude project`, once we're ready to build).
3. Terminal-launch target on Ubuntu — no default; needs a real decision
   (gnome-terminal? user's `$TERMINAL`? something else?) or an in-widget
   settings field for "terminal command template."
4. If/when LocalCode-full gets built as a separate app outside this repo,
   should wigl's lite widget deep-link into it (e.g. custom URL scheme) or
   stay terminal-only? Not a wigl-repo decision to make now.
