# LocalCode — agent notes

Read this before touching the widget. It's not a tour of the folder — read
the code for that — it's the decisions and gotchas that don't survive
reading the code cold. Product framing lives in `sketch.md` (kept from the
research pass); this file is dev-facing only. Deferred/delegated work lives
in root `backlog.md`, not here — this file is decisions and gotchas for
code that already exists.

## What this actually talks to

`opencode serve`, driven over its **HTTP + SSE API**, not the `opencode run`
CLI. That's a deliberate departure from every other wigl widget's "shell
command, parse stdout" data flow (`docs/architecture.md`'s pattern) — a
one-shot `opencode run --format json` per turn cannot deliver permission
approval, revert/undo, sub-agent visibility, or token-level streaming;
those live behind the server's stateful session object. `opencode run`
event JSON and the HTTP API are two different wire formats — don't mix
them.

The server is still reached only through wigl's shell primitives —
`serverProcess.ts` spawns `opencode serve --port 0` via the new
`runCmdBackground` (added to `@/wigl/utils` for this widget, see "Host
primitives added" below) and captures the bound port from its stdout
(`opencode server listening on http://127.0.0.1:<port>`, matched by
`PORT_RE`). Everything after that — session CRUD, prompting, event
streaming — is plain `fetch()`/`EventSource` from the widget's own JS
against `http://127.0.0.1:<port>`, **not** `runCmd`. That's intentional:
wigl's shell primitives only ever proxy a command's stdin/stdout/exit code,
they have no concept of an HTTP request/response, so once the server is up
there's nothing for `runCmd` to mediate. CORS is a non-issue — verified
live that `opencode serve` reflects whatever `Origin` header the request
carries (`Access-Control-Allow-Origin: <origin>`), so no `--cors` flag is
needed regardless of what origin the Tauri webview reports itself as.

## Where the API shapes come from

`client.ts` is backed by `@opencode-ai/sdk/v2/client`'s generated
`createOpencodeClient` — not hand-rolled `fetch` anymore. That package
ships *two* differently-vintaged generated schemas: the default/top-level
export is stale (verified live: missing the `variant` field this widget's
reasoning-effort chip depends on entirely), while `/v2` was verified field-
by-field against a live **`opencode serve` v1.18.15** instance's own `/doc`
OpenAPI dump to actually match — **always import from `@opencode-ai/sdk/v2/client`
specifically**, never the bare `/v2` or top-level export (the latter two
re-export `./server.js`, which requires the Node builtin `cross-spawn` and
breaks widget bundling outright — verified live, `Bun.build` targets a
browser environment). Don't assume a future SDK bump keeps matching this
server; re-verify against a live `/doc` dump the way this was, don't trust
a version number alone.

`types.ts` still declares its own trimmed types (only the fields this
widget reads/writes, not full objects) rather than importing the SDK's —
those are real request/response types generated straight from opencode's
schema, and using them for `client.ts`'s inputs is exactly the point (a
field rename becomes a `bun run typecheck` error, not a silent mismatch).
But the SDK's *response* shapes are wide, deeply-nested, and change often;
re-deriving `types.ts`'s narrow domain types from them on every field would
turn every unrelated opencode schema change into a wave of unrelated
widget edits. `types.ts`'s types are kept structurally close enough that a
real SDK response satisfies them (verified live, not just typechecked in
isolation), and a mismatch surfaces the same way — a compile error in
`client.ts`'s return statements — the moment the two drift.

Things confirmed live that aren't obvious from guessing:
- SSE frames are plain `data: {...}\n\n` with no custom `event:` name, so
  `new EventSource(...).onmessage` catches everything — no per-type
  listener wiring needed. `subscribeEvents` stays on plain `EventSource`
  rather than the generated client's own `event.subscribe()` — see that
  function's doc comment in `client.ts` for why (a real streaming-body
  risk on WKWebView, not proven broken but not worth risking against this
  widget's entire live-chat UX for an optional swap).
- Reasoning-effort options are **per-model**, not a fixed enum: each
  model in `/config/providers` may have a `variants` map (e.g.
  `{ high: { reasoningEffort: "high" } }`); a model with no `variants` has
  no effort control at all. `Composer.tsx` shows the effort chip only when
  the selected model declares `variants` — never hardcode a global
  low/medium/high list.
- opencode's own error union isn't internally consistent about where the
  message text lives — verified live: most error kinds are `{ name, data:
  { message } }`, but `SessionBusyError` (the 409 a revert-mid-turn throws)
  is a flat `{ _tag, message }` instead. `client.ts`'s `unwrap` checks both
  shapes rather than assuming one.
- There's no dedicated "edit message" endpoint. `client.ts`'s
  `revertToMessage` + a fresh `sendPrompt` is opencode's own intended
  composition for "redo this turn" — that's what `editAndResend` in
  `useActiveSession.ts` does. Branching (fork instead of revert, so the old
  answer survives) exists in the API as `/session/{id}/fork`, but verified
  live against `opencode serve 1.18.15` that the running server doesn't
  actually link a fork back to its parent — the forked session comes back
  with 0 messages copied and no `parentID` set, despite the OpenAPI schema
  declaring that field. Blocked upstream, not just unwired — see backlog.md.

## Host primitives added for this widget

Two changes outside `wigl-widgets/LocalCode/`, both needed to keep a
server process alive and controllable — this is new precedent, no other
widget spawns a long-lived background process:

- `runCmdBackground` in `src/wigl/utils/index.ts` — spawns via
  `Command.spawn()` and returns `{ stop }`, unlike `runCmdStreaming` which
  only resolves once the process exits on its own. Gated behind the same
  `"command"` permission as `runCmd`/`runCmdStreaming` in
  `src/wigl/plugins/registry.ts`.
- `shell:allow-kill` added to `src-tauri/capabilities/default.json` — bare
  identifier, no scope (Tauri's shell plugin permission for `kill` has no
  per-command scoping the way `execute`/`spawn` do; it operates on an
  already-spawned child, not a program name).
- `@coss/textarea` and `@coss/scroll-area` added under
  `src/components/ui/` and registered in both
  `src/wigl/plugins/host-modules.ts` and `registry.ts` — no chat widget
  existed before this one, so neither primitive was needed yet.

If a future widget also needs a controllable background process, this is
the primitive to reuse — don't add a second one.

## Server lifecycle — known rough edges

- **A session's `directory` comes from the `serve` process's own cwd, not
  from the request.** Verified live: `POST /session`'s `directory` field is
  silently ignored — the session that comes back always has `directory`
  set to wherever `opencode serve` itself was launched from, regardless of
  what the request body asked for. opencode's session store is one global
  SQLite DB (`~/.local/share/opencode/opencode.db`) shared by *every*
  `opencode serve` invocation on the machine, keyed by that directory —
  found this by writing the e2e suite: 30+ leftover test sessions all
  showed up in the real widget's sidebar, because `GET /session` with no
  `directory` query param returns every session for every directory ever
  used, and `useSessions.ts` wasn't filtering. Fixed on both sides:
  `startOpencodeServer(cwd, ...)` in `serverProcess.ts` now spawns with
  `cwd` set to the widget's `defaultDir` (threaded from `index.tsx` through
  `useOpencodeServer(directory)`, gated so the server doesn't spawn until
  `defaultDir` actually resolves from `homeDir()`), and `client.ts`'s
  `listSessions(baseUrl, directory)` / `useSessions.ts` scope both the
  initial fetch and live `session.*` SSE events to that same directory.
  `runCmdBackground` (`src/wigl/utils/index.ts`) gained an optional 4th
  `options` param (`{ cwd }`, Tauri's `Command.create`'s own 3rd argument)
  to make this possible — it didn't support any spawn options before.
- One `opencode serve` process for the widget's lifetime, started on
  mount, killed on unmount (`useOpencodeServer.ts`). It is **not** shared
  across monitors/windows — each screen's `Desktop` is its own JS realm
  (see `docs/architecture.md`), so a LocalCode instance on two monitors
  today would spawn two independent servers on two random ports, each with
  its own session list. Fine for the common single-monitor-with-LocalCode
  case; would need a real fix (e.g. a lock file with the port, or picking
  a fixed port) if that setup becomes real.
- `startOpencodeServer` in `serverProcess.ts` only detects success (the
  "listening on" stdout line) or a timeout — if the process spawns fine
  but crashes immediately after (e.g. port race, corrupt config) without
  printing that line, it silently sits in "connecting" until the 8s
  timeout, not a fast failure. `runCmdBackground` doesn't currently
  surface the process's exit/error events past spawn — extending it to do
  so would fix this properly.
- PATH fallback candidates (`OPENCODE_CANDIDATES`) are `~/.bun/bin/opencode`
  first since that's how it's installed on this dev machine (`bun install
  -g`) — if opencode ships a different common install path later (Homebrew
  formula, apt package, ...), add it to that list the same way
  `commands.ts`'s `openInEditor` layers candidates for VS Code.
- **Ollama replies used to arrive as one end-of-turn dump — it was a real
  wigl bug, fixed.** opencode's SSE feed sends two different event shapes
  for an assistant's reply: coarse `message.part.updated` snapshots, and
  per-token `message.part.delta` (`{ partID, field: "text", delta }`,
  additive fragments — same pattern as its `reasoning-delta` handling).
  `eventReducer.ts` only had a case for `message.part.updated`; for
  providers/models that send few `part.updated` snapshots across a whole
  turn (Ollama, confirmed live), the transcript looked frozen until
  everything landed at once, even though `part.delta` events were arriving
  incrementally the entire time. Fixed by adding a `message.part.delta`
  case to `applyEvent` that appends `delta` onto the matching part's text.
  Verify with `tests/manual/ollama-stream-check.py`, which measures both
  Ollama's raw HTTP streaming and opencode's `/event` feed independently.

## Model catalog: why `opencodeConfig.ts` exists

opencode has **no dynamic Ollama discovery** — verified live: a custom
`openai-compatible` provider (the only way to point opencode at Ollama's
local API) must list every model explicitly under `provider.<id>.models`
in `~/.config/opencode/opencode.jsonc`; `opencode models ollama` returned
`Provider not found: ollama` until a `models` block existed, even with
Ollama itself running and reachable. `opencodeConfig.ts`'s
`syncOllamaModels()` closes that gap by writing whatever `ollama.ts`'s
`listOllamaModels()` (hits Ollama's own `/api/tags`) reports into that
config file — that's what makes the model picker track installed Ollama
models instead of being a list someone typed once.

**Config is not hot-reloaded** — verified live: editing `opencode.jsonc`
while a `serve` instance was already running had zero effect until
restart. So the sync must run *before* `startOpencodeServer()`, not after
— `useOpencodeServer.ts` does exactly that, best-effort and time-boxed
(`OLLAMA_SYNC_TIMEOUT_MS`, currently 2s) so a not-yet-running Ollama never
blocks the widget from starting. A model pulled mid-session needs a manual
`reloadModels()` (re-syncs, then restarts `serve`) to become selectable —
this used to be an automatic 15s poll instead, removed after owner
feedback that constant background polling for a rare event ("did the user
just run `ollama pull`") wasn't worth it, especially with nothing to show
for it when Ollama was down (see `useOpencodeServer.ts`'s "Ollama
reachability" section). `ollamaOnline` (checked once per connect/reload,
not polled) is what index.tsx's status area shows instead.

`opencodeConfig.ts` uses plain `JSON.parse`/`stringify`, not a real JSONC
parser — no widget bundles its own npm dependency yet (every widget's
`package.json` "dependencies" has been empty so far) and adding one just
for this felt like the wrong precedent to set for a narrow internal tool.
This fails safe: a config file containing real `//` comments won't parse
and the sync is skipped (logged, not thrown) rather than risking a
corrupting rewrite. If that ever actually bites someone, `jsonc-parser`
(small, MIT, what VS Code itself uses) is the fix — `bun add` it inside
`wigl-widgets/LocalCode/` to get a local `node_modules` the bundler will
pick up, same as any other widget-bundled dependency would.

The model picker itself is scoped to `ALLOWED_PROVIDER_IDS` in `config.ts`
(currently just `["ollama"]`) — opencode's `opencode` (Zen) provider is
active out of the box with zero setup, which is what made model selection
read as "predefined" rather than "reliant on Ollama" before this existed.
Add Claude Code (or any other backend) to that list, not a special case,
when it's wired up.

### Reasoning-effort dropdown: why it used to stay disabled for every model

`syncOllamaModels()` originally wrote `models[name] = { name }` and nothing
else — no `variants` field, ever, for any Ollama model. The effort control
(a `<Select>` originally, a slash `/think`, now the effort chip menu) only exists when the selected model's
catalog entry has a `variants` map, so with every synced model missing one,
it was permanently unavailable regardless of which model was picked — not a
per-model bug, a structural one. Fixed: `ollama.ts`'s
`getModelInfo(name)` calls Ollama's own `POST /api/show` and checks
whether `"thinking"` is in the returned `capabilities` array (verified
live: present for `qwen3.5:0.8b`, absent for `smollm:135m`) — the same call
also reads the model's real context length off `model_info`, so both live
in one cached-per-model-name result. `useOpencodeServer.ts`'s
`prepareOllamaModelSync()` resolves this for every installed model
(parallelized, still inside the same `OLLAMA_SYNC_TIMEOUT_MS` budget as the
rest of the sync) and hands `{ name, thinking, contextLength }` triples to
`syncOllamaModels()`, which now writes a fixed `variants: { high: {
reasoningEffort: "high" }, low: { reasoningEffort: "low" } }` block for any
model that came back thinking-capable — and, on an existing config from
before this fix, patches that block onto an already-declared model entry
that's missing one, so nobody needs to delete `opencode.jsonc` by hand to
pick this up.

**Verified live:** `reasoningEffort` in a `variants` entry
does reach Ollama — confirmed by putting a logging HTTP proxy in front of
Ollama's own port, pointing opencode's `ollama` provider `baseURL` at it,
and diffing the outgoing `/v1/chat/completions` body. `variants: { low:
{ reasoningEffort: "low" } }` produces `"reasoning_effort":"low"` in that
body unchanged — opencode's `openai-compatible` provider forwards the field
verbatim, it doesn't silently drop it. The value that matters is `"none"`:
Ollama's OpenAI-compatible endpoint treats `reasoning_effort: "none"` as a
real off switch — no `reasoning`/`<think>` output at all for the same
prompt that produces one with the field omitted — while `"low"`/`"high"`
just shorten or lengthen the trace. `REASONING_VARIANTS` in
`opencodeConfig.ts` now declares `off: { reasoningEffort: "none" }` as a
real variant (patched onto existing configs the same way a missing
`variants` block was), and `Composer.tsx`'s "Off" chip sends `"off"` as the
actual `variant`, not `undefined` — sending `undefined` was the bug: it's
"no override", which just leaves Ollama on its own default thinking
behavior instead of suppressing it.

## Skills — disabled for now

opencode discovers and offers **the same Agent Skills Claude Code uses**
automatically — `~/.claude/skills/<name>/SKILL.md`, no wigl-side config,
confirmed live via `opencode agent list`'s permission dump listing an
`external_directory` allow-rule for a skill folder under `~/.claude/skills/`
before this widget had written anything about skills at all. This closes
the "unconfirmed" question the old backlog entry here used to raise.

Owner feedback: small local models (the only kind this widget targets —
`ALLOWED_PROVIDER_IDS` is Ollama-only, see "Model catalog" above) don't
handle these skills the way Claude Code itself does and "get kinds nuts"
from them — a skill written and tuned for a frontier model's instruction-
following isn't something a `smollm:135m`/`qwen3.5:0.8b`-class model can
reliably parse and act on. `opencodeConfig.ts`'s `disableSkillTool()` now
sets `tools.skill: false` globally in `opencode.jsonc` before `serve`
starts (same not-hot-reloaded rule as the Ollama model sync above) — global
rather than per-agent because this widget doesn't own opencode's agent
definitions (`build`, `plan`, or any custom agent installed via `opencode
plugin`, e.g. a `cavecrew-*` set already present on the machine this was
verified against) and has no business rewriting someone else's agent
config just to reach into `build`'s tool list.

**This needs revisiting, not left disabled forever.** The right fix isn't
"never give a local model skills," it's matching the skill (and how it's
presented — shorter, more directive, fewer implicit assumptions about
prior context) to what a small model can actually follow. That's a real
piece of design work with no concrete spec yet — don't build a "smart"
skill-filtering system speculatively; wait for a concrete direction on
what a local-model-appropriate skill should look like.

## Default agent — never opencode's own "build" default

A brand-new session (no explicit/remembered agent) used to send no `agent`
field at all, which opencode itself defaults to `"build"` — its full-tools
primary agent (bash, edit, ...). Verified live this is a real hazard, not a
theoretical one: a tool-capable local model (`qwen3.5:0.8b`) given a bare
"test?" message under `build` went looking for a "test" *tool* to run and
attempted `bash -c 'curl https://opencode.ai/docs/test'` — a small model
reading "test?" plus a bash tool sitting right there in its context and
inventing a plausible-looking command, not a targeted attack or a wigl
parsing bug. `opencodeConfig.ts`'s `syncChatAgent()` now declares
`config.ts`'s `DEFAULT_CHAT_AGENT` (`"wigl-chat"`) as a primary agent with
`permission: "deny"` before `serve` starts, and `useActiveSession.ts`'s
`send()` falls back to it instead of leaving `agent` unset. Verified live
that `permission: "deny"` at the agent level keeps the tool schema off the
completion request entirely — no attempted call, and (bonus) no more "does
not support tools" 400 from models that can't do function-calling at all
either, which is what `Composer.tsx`'s existing `TOOLLESS_AGENT` fallback
was separately working around for that narrower case. The agent chip still
lets a session opt into `build`/`plan`/anything else when real tool use is
actually wanted — this only changes what an untouched session starts as.

`syncChatAgent()` also sets a custom `prompt` on `wigl-chat` (`AgentConfig`'s
`prompt` field, which replaces opencode's default system prompt outright) —
without it, a toolless model handed opencode's default agentic-coding
prompt doesn't just ignore the tool-call/task-tracking instructions it
can't act on, it spirals into confused meta-commentary about them, verified
live to be worse than the bash-hallucination bug this agent exists to
prevent.

**Not fixed by this, and not per-agent-configurable at all:** opencode
injects the working directory's `AGENTS.md`/`CLAUDE.md` into the system
prompt regardless of which agent is active or what its `prompt` says —
verified live, `wigl-chat` included, a model can still ramble about wigl's
own architecture on an unrelated prompt like "what is this project about?".
Confirmed against opencode's published config schema that no per-agent or
global field suppresses that injection, and confirmed live that telling the
model in `prompt` to ignore project context doesn't work either — a known
limitation of small local models with negative instructions, not something
this widget can configure around.

## No housekeeper model

There used to be a `housekeeper.ts` running small internal-task prompts
(session title generation) against a throwaway session on a small/fast
local model. Deleted — see "Session titles are a plain timestamp" below for
why. If a real second use case for a scratch-session/toolless-model pattern
shows up, re-derive it fresh rather than resurrecting the deleted file;
`git log` has it if the shape is worth stealing.

The real chat composer has an unrelated but similarly-shaped failure mode:
no explicit agent selection defaults to `"build"` server-side, which always
attaches opencode's full tool schema — verified live that Ollama 400s with
"does not support tools" for models that don't support function-calling at
all. `Composer.tsx` checks the selected model's
`ProviderModel.capabilities.toolcall` and, when `false`, forces
`agent: "title"` (opencode's own hidden, toolless, purpose-built agent —
guaranteed not to attach a tool schema) and disables the agent chip, rather
than letting the request go out with the default.

## UI shape (post-redesign) — read before adding a control

The redesign pass replaced the first, functional-but-cramped UI. Its rules,
because "add a dropdown" is the default instinct and it's the wrong one here:

- **Per-turn settings are chip dropdowns, not slash commands.** Model, agent,
  and reasoning effort are the chip row under the composer (`Composer.tsx`'s
  `ChipMenu`, a `@/components/ui/popover`): each chip is both the
  current-state readout *and* its own control — clicking it opens a dropdown
  and selecting sets the value. **It never touches the composer text.** This
  reversed an earlier "slash commands *are* the settings UI" design (`/model`,
  `/agent`, `/think`, parsed by a now-deleted `commands.ts`): a command that
  overwrote what you were typing and fought its own palette wasn't an
  intuitive flow (owner's call — "UI options should remain UI options"). A `/`
  in the composer is now just literal text the agent receives. A new per-turn
  setting is a new `ChipMenu`, not a slash command. Something that changes
  once a month is a constant in `config.ts`, not UI at all.
- **Enter is a newline. ⌘/Ctrl/⌥+Enter sends.** Explicit owner call ("I
  personally hate this in every LLM UI"). Same binding for edit-and-resend in
  `MessageList.tsx`. Don't "fix" this back.
- **Markdown is tokenized, never HTML.** `markdown.ts` (pure, tested) emits
  spans/blocks; `components/Markdown.tsx` renders them as React children.
  This is what closed the "broken agent responses formatting" report —
  headings/lists/quotes/fences now parse, and emphasis delimiters must hug
  their text so `2 * 3 * 4` and glob patterns stop turning into italics.
  The `dangerouslySetInnerHTML` ban (see Hard rules) is why a real markdown
  library is not an option.
- **The composer field is Milkdown's Crepe editor, not a plain `<textarea>`
  (and no longer CodeMirror).** WYSIWYG markdown with native list handling —
  `- `/`1. ` start lists, `Tab`/`Shift+Tab` nest/unnest (the hard requirement
  that drove the choice), `Enter` continues/exits a list. Two files:
  `components/CrepeField.tsx` (a controlled React wrapper: create once, sync
  external `value` in via `replaceAll`, forward edits out via Crepe's
  `markdownUpdated` listener) and `components/composer.css` (the required
  stylesheet). Three things that are load-bearing, not incidental:
  - **`CrepeBuilder` from `@milkdown/crepe/builder`, never the `Crepe`
    umbrella.** The umbrella statically imports *every* feature (katex,
    `@codemirror/language-data`, codemirror `basicSetup`, dompurify, …) whether
    enabled or not; in this repo's non-tree-shaking single-file widget bundle
    that's ~17MB. The builder pulls only what you `addFeature` — here just
    `list-item` and `placeholder`. Bundle lands ~5.6MB (up from the
    CodeMirror era's ~3.8MB; the delta is Vue + ProseMirror, the price of a
    real WYSIWYG editor, and was accepted deliberately). Crepe's own
    code-block CodeMirror feature is left off for the same language-data bloat
    reason the old CodeMirror pass documented — fenced code stays plain.
  - **The editor libs load via dynamic `import()` inside the mount effect, not
    static top-level imports.** Milkdown's Vue/ProseMirror modules touch
    `document` at evaluation time, which crashes `widget:check`'s headless
    render. Deferring the import to the browser-only effect keeps the module
    import-safe; Bun inlines the dynamic imports into the one bundle (no
    chunks), so it still loads through the blob loader.
  - **`⌘/Ctrl/⌥+Enter` sends via a capture-phase `onKeyDownCapture` in
    `Composer.tsx`, not a ProseMirror keymap.** A capture handler on the editor
    wrapper runs before ProseMirror's own keydown on the inner contentEditable;
    `preventDefault` + `stopPropagation` there stops the descent so Milkdown
    never inserts a newline for the send chord. Simpler than injecting a
    high-precedence PM keymap. Plain `Enter` is never intercepted, so
    Enter-never-submits holds. (This handler used to also drive the slash
    palette's arrow/Tab/Enter navigation; that's gone with the palette.)
  - **No headings or code blocks from typing:** the `wrapInHeadingInputRule` +
    `headingKeymap` **and** `createCodeBlockInputRule` + `codeBlockKeymap` are
    `crepe.editor.remove(...)`'d right after build (before `create()`), so
    `# ` and ` ``` ` stay literal text in a prompt instead of silently
    reshaping the editor mid-keystroke (the fence in particular read as
    "nothing happens, then the closing backticks turn it into a code input").
    The nodes stay in the schema so pasted markdown still round-trips; nothing
    auto-formats as you type.
  - **Cursor:** the `cursor` feature (which layers `prosemirror-virtual-cursor`,
    a fake caret element, on top of the native one) is left OFF — it ghosted a
    duplicate caret, worst inside code blocks. The native contentEditable caret
    is the only one, made theme-visible via `caret-color: var(--foreground)` in
    `composer.css` (no `cursor.css` import).
  - **Theming:** Crepe's shipped color themes are never imported (hardcoded
    colors, banned). `composer.css` imports only the structural common CSS the
    enabled features need and bridges Crepe's `--crepe-color-*` variables to
    wigl tokens, plus compactness overrides so a document editor reads as a
    chat box. List markers are bumped from the faint `--crepe-color-outline` to
    `--foreground`/80% so they read as clearly as the text.
- **Everything stays widget-local.** Nothing here was promoted into
  `src/wigl/` despite the "make it reusable" ask: the repo rule is that
  nothing becomes shared until a *second* widget concretely needs it, and no
  second chat-shaped widget exists. The reusable pieces that already exist
  (`Button`, `ScrollArea`, `cn`, `useStorage`) are used; the rest — palette,
  trace rows, turn layout — is one widget's opinion and would be a bad
  general API today. The one thing genuinely shared-shaped, an error
  surface, is still `backlog.md`'s F1 for exactly that reason.
- **Theme tokens only.** The old `PermissionBar` amber literal is gone; every
  color is a semantic token. Check any new class against `docs/theming.md`.
- **No per-message metadata.** No role labels, no model name, no timestamps
  in the transcript — an accent rule down the left of a prompt is the entire
  turn marker. Owner review: "still too much detail in messages... LESS IS
  MORE". If you're about to add a badge to a message, don't.
- **Consecutive same-type parts render as one block** (`mergeParts` in
  `PartRenderer.tsx`). opencode flushes an answer as many small `text`/
  `reasoning` parts; rendering each on its own is what made a reply look like
  "a long list of darker cells". Code fences are one flat surface now, no
  border, no language chrome, for the same reason.
- **Runaway repetition is handled twice, on purpose** (`repetition.ts`,
  tested): `splitAtRepeat` folds a repeated tail behind a "N repeated lines"
  toggle so a spiral doesn't bury the useful part of an answer, and
  `endsInLoop` aborts the turn outright when the same ≥24-char phrase lands
  three times back-to-back. Local models don't recover from these on their
  own. The abort rule is the strict one because killing a live turn is the
  expensive mistake; the fold is loose because being wrong there costs a
  click. The fold idea comes from the chatWidget in `jayf0x.github.io`.
- **The busy indicator runs for the whole turn**, not just the gap before the
  first token — a reply streaming into a collapsed reasoning trace is
  indistinguishable from a frozen widget otherwise.

## Decisions log (so they don't get re-litigated from scratch)

- **`session.error` must be handled, not just typed.** Found live: a failed
  turn (unknown model, or a tool-incapable model under the default `"build"`
  agent — see "No housekeeper model" above) produces a `session.error` event
  and *no* assistant `message.updated` at all — nothing else signals the
  failure. Before this was handled, that event fell through
  `useActiveSession`'s event switch's `default` case and did nothing: no
  assistant bubble, no error, and (once a busy/loading flag existed) it
  would've stayed stuck — this was very likely the concrete report behind
  "prompt → loading → no reply ever shown". The fix: `useActiveSession`'s
  event handling moved into a pure `applyEvent` reducer
  (`eventReducer.ts`) that sets `state.error`/clears `state.busy` on
  `session.error`, `SessionPanel.tsx` renders `session.error` as a
  dismissible banner, and `Composer`'s `disabled` prop (previously never
  wired from `SessionPanel`) is now driven by `session.busy`. Regression
  coverage: `tests/eventReducer.test.ts` (synthetic events) and
  `tests/opencode.e2e.test.ts` (a real unknown-model turn against a live
  server).
- **Event-application logic is a pure reducer, not inline `setState` in the
  hook.** `eventReducer.ts`'s `applyEvent(state, event, sessionID)` is the
  entire "what does this SSE event do to the transcript" decision —
  `useActiveSession.ts` is just `setState(prev => applyEvent(prev, event,
  sessionID))` plus the subscribe/unsubscribe glue. Done specifically so
  this logic — the exact code that decides whether a reply becomes visible
  — is unit-testable without a React runtime (`docs/principles.md`'s
  functional-core/imperative-shell rule). If you add a new event case, add
  it to `applyEvent` and a case to `tests/eventReducer.test.ts`, not
  directly into the hook.
- **Editing a message mid-reply must be blocked, not just caught.**
  Verified live: `POST /session/{id}/revert` returns `409 SessionBusyError`
  while the session is still generating — reverting to an earlier message
  to "edit and resend" it makes no sense mid-turn anyway, but the old code
  let you try, and `editAndResend`'s rejected promise went nowhere (no
  `.catch`, no visible feedback — reported as "editing a question gave an
  error"). Fixed two ways: `MessageList.tsx` disables the per-message edit
  trigger whenever `session.busy` (mirrors `Composer`'s own disabled state),
  and `editAndResend` in `useActiveSession.ts` now catches a revert failure
  into `session.error` as defense in depth against the race (busy flips
  true between a click and the call landing). Regression coverage:
  `tests/opencode.e2e.test.ts`'s "editing a question mid-reply" case.
- **Session-level actions that already existed in the hooks had no UI.**
  `useActiveSession.ts`'s `abort()` and `useSessions.ts`'s `deleteSession()`
  were both fully implemented and completely unwired — no button called
  either one. Owner feedback: "the UI still feels lazy... I expected more
  features to already be implemented." Fixed: `Composer.tsx` swaps the send
  button for a stop button (`onAbort`) whenever `busy`; `SessionRow.tsx` got
  a hover-revealed delete button (confirms via `window.confirm` before
  calling through `Sidebar` → `index.tsx`'s `handleDelete`, which also
  clears `activeID` if the deleted session was the active one). Also added
  in the same pass: `MessageList.tsx` auto-scrolls to the bottom on new
  content (there was no scroll-following at all — a streaming reply was
  invisible unless you kept scrolling manually).
- **No diff view.** `PartRenderer.tsx`'s `patch` case is a one-line "N
  files changed" — deliberately not OpenGUI's `DiffView.tsx`. Owner's
  framing: don't rebuild what a real editor/git tool already does well: "no
  fancy features like transcribe or audio... don't repeat what other apps
  already solve."
- **Session titles are a plain timestamp until the user renames one —
  opencode's own auto-generated title is never shown.** opencode runs a
  native title-generation agent on a session's first message regardless of
  anything this widget does, and a wigl-side housekeeper-model call used to
  duplicate that work (deleted — see "No housekeeper model" above). But the
  bigger reason opencode's title isn't surfaced at all anymore: its output
  quality wasn't reliable enough to show as-is (owner's call). `useSessions.ts`'s
  `defaultTitle()` formats the session's own `time.created` instead;
  `titles[id]` (manual rename, unchanged) still overrides it immediately.
  Revisit if/when a replacement titling approach lands (see backlog.md).
- **A render window, not virtualization.** `MessageList.tsx` mounts only the
  last `RENDER_WINDOW` (40) messages and puts the rest behind one "N earlier
  messages" button. This is the answer to the long-standing "conversations
  need virtualization" ask, and it's deliberately *not* a windowing library:
  the content is streaming, variable-height, and individually collapsible
  (reasoning/tool traces own their open state), which is the exact case
  measurement-based virtualizers handle worst. Ten lines buy the same win —
  a 500-turn session never mounts 500 collapsible trees. Revisit only if
  someone actually expands a huge session *and* it stutters; the fix then is
  a real virtualizer, not a smaller window.
- **Ollama: status only, no start/stop control.** `ollama.ts` polls
  `GET /api/tags` every 10s; there's no code path that spawns `ollama
  serve`. Explicit owner call during scoping — Ollama is normally already
  running as a system service, and boot-control was judged lower priority
  than getting opencode's own lifecycle right first.
- **opencode only, not Claude Code CLI too.** Explicit owner call — one
  backend, one adapter, ship it working before doubling the surface. If
  Claude Code support gets added later, it needs its own equivalent of
  `client.ts` behind the same shape (`listSessions`, `send`, `subscribe`, …)
  — Claude Code has no `session list` subcommand, so that adapter would
  need to scan `~/.claude/projects/*/*.jsonl` by mtime instead of hitting
  an API list endpoint. Don't assume the two adapters can share much beyond
  the interface shape.
- **Permissions map directly onto opencode's own ask/reply protocol**
  (`PermissionBar.tsx` + `client.ts`'s `replyPermission`) — `once` /
  `always` / `reject`, nothing wigl-invented layered on top. Explicit
  owner call: "should simply map OpenCode's own protocols... should not
  reinvent custom flow for this."
- **Two separate SSE connections** — `useSessions.ts` subscribes for
  `session.*` events, `useActiveSession.ts` subscribes separately (same
  `/event` endpoint) for message/part/permission/todo events on whichever
  session is active. Simpler than threading one shared event bus through
  two hooks; revisit only if the number of concurrent `EventSource`
  connections ever becomes a real problem (it won't at the scale of "one
  widget, one server").

## Testing

`wigl-widgets/LocalCode/tests/*.test.ts` (`wigl test widgets` or
`bun test wigl-widgets/LocalCode/tests`), split by cost — **don't rerun the
two `*.e2e.test.ts` files after every small edit**, they hit a real local
model; owner feedback was explicit about this being a real resource cost,
not just token spend. Reach for `eventReducer.test.ts` (instant) or
`opencode.session.e2e.test.ts` (seconds, no real generation) while
iterating; save `opencode.generation.e2e.test.ts` (can take over a minute)
for a final pass once changes are batched.

- `eventReducer.test.ts` — pure, no server needed, runs anywhere. Feeds
  synthetic (but shape-accurate, copied from real captured frames) SSE
  events through `applyEvent` and asserts on the resulting state. This is
  where a new event case's logic gets tested, not either e2e file.
- `opencode.session.e2e.test.ts` — real `opencode serve`, but only session
  CRUD/directory-scoping/error-shape assertions that don't wait on a real
  model generation (an unknown-model turn fails fast, before ever reaching
  Ollama). Cheap enough to run while iterating on anything that isn't
  reply-generation logic itself.
- `opencode.generation.e2e.test.ts` — the expensive half: a real
  `qwen3.5:0.8b` (a real thinking model, so reasoning content can be
  asserted on) generation. `smollm:135m` is pulled alongside it only
  because opencode's own native title agent needs a model to run against.
  Content is deterministic given the fixed seed, but **wall-clock isn't**
  — the same exact generation measured ~6s to ~50s across runs on one dev
  machine (Ollama serializes generation per model, `-np 1`, so GPU
  contention with anything else running matters) — hence the generous
  90s-per-turn timeout and the `abortSession` call on that timeout, so an
  abandoned request doesn't sit in Ollama's queue and slow down whatever
  runs next.

Both e2e files need real Ollama models pulled (`qwen3.5:0.8b`,
`smollm:135m`) and skip (not fail) otherwise. `test.skipIf`'s condition is
evaluated at module load, before any `beforeAll` runs, so the
Ollama-availability check and server startup happen via top-level `await`
at the top of each file, not inside `beforeAll` — a `beforeAll`-gated
`skipIf` always sees the pre-check value and skips everything, silently.
`tests/testServer.ts` holds the shared setup (`setupE2eSuite()`, one call
per file — each file spins its own server process rather than sharing one
across files, simpler than a cross-file singleton and the startup cost is
a few seconds, not the expensive part) and helpers:
`withDeterministicModels()` temporarily writes `temperature: 0, seed: 42,
num_predict: 64` into the two test models' `opencode.jsonc` entries (backs
up and restores the file exactly, including deleting it if it didn't exist
— production code must never see forced-greedy decoding, only a test run
should), and `installEventSourcePolyfill()`/`subscribeEventsViaFetch()`
work around `EventSource` not existing as a global under `bun test`
(confirmed: `typeof EventSource === "undefined"` even mid-suite, unlike the
real Tauri webview) by re-parsing the same `data: {...}\n\n` SSE framing
over a raw `fetch` stream.

## Backlog

Open, not-yet-built work for this widget (branching, sub-agent visibility,
multi-monitor server sharing, session-title replacement) lives in root
`backlog.md`, not here — that's the one canonical backlog for the whole
repo (see root `AGENTS.md`'s docs table). Skills are not backlog material —
see "Skills — disabled for now" above for that decision's actual current
state.

## Hard rules specific to this widget

- Never render agent output through `dangerouslySetInnerHTML` — it's LLM
  output, i.e. untrusted content, and CSP is disabled app-wide. `Markdown.tsx`
  exists specifically so nothing here reaches for a real markdown-to-HTML
  library; keep it that way, or if a real one genuinely becomes necessary,
  make sure it can't emit raw HTML (a "safe subset" renderer, not just
  "sanitize afterward").
- `types.ts` types are intentionally partial mirrors of opencode's real
  schemas — don't "complete" them defensively. Add a field only when a
  component actually reads it, and verify the field's real name/shape
  against a live server first (see "Where the API shapes come from").
