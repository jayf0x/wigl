# TODO — LocalCode

Deferred/delegated work for the `LocalCode` widget (`wigl-widgets/LocalCode/`)
— a chat UI for driving local coding agents (opencode + Ollama today, Claude
Code later). Each entry below is self-contained: enough context to start
without re-reading the whole build session, not a re-explanation of the
whole widget. Read `wigl-widgets/LocalCode/AGENTS.md` first regardless —
it's short and has the load-bearing facts (API shapes, server lifecycle,
decisions log) every entry here assumes you already know.

Delete an entry when it's done — this file isn't a changelog.

## UI

The redesign pass is **done** — collapsible sessions rail, slash-command
settings (`/model`, `/agent`, `/think`), document-style transcript with
capped-height trace rows, real markdown tokenizing, ⌘↵-to-send, and a
pending indicator while a turn generates. The rules that came out of it live
in `wigl-widgets/LocalCode/AGENTS.md`'s "UI shape (post-redesign)" section —
read that before adding any control. What's left is below.

### needs a real shared error surface


Error component. Each widget should have this so that errors are caught. What I would maybe do is raise a custom error that could show a custom styled error in the design, eg. ollama is not booted gives a differently styled error than a bug. But this is maybe backlog material.

**What's still needed, not built**: when something actually _is_ broken
(opencode failed to start, a prompt errors, Ollama isn't reachable when a
turn is sent), the user currently has no on-screen explanation beyond
`SessionPanel.tsx`'s inline `session.error` banner (which only covers a
failed turn, not "the server never came up" or "Ollama's not running at
all"). The right fix is a **shared `wigl` component** (belongs in
`src/wigl/`, behind the `@/wigl` barrel per `docs/widgets.md`'s sharing
rule — not something LocalCode should own privately, since any widget that
talks to an external process/API has the same "how do I tell the user this
broke" gap) — an error overlay/screen a widget can show when it has a
real, current error condition, replacing ad-hoc per-widget status UI like
the bar that was just removed here. Trigger to build it: whenever this
widget (or a second widget) next needs to surface a hard error state, build
the shared component then rather than a LocalCode-only one — matches
`docs/architecture.md`'s "nothing becomes shared until a second concrete
need exists" rule already applied to everything else in `@/wigl`.
`useOpencodeServer.ts`'s `status`/`restart` and `client.sendPrompt`'s
rejection path are exactly the signals such a component would consume;
nothing about the removal here throws that data away.

## Other

### Everything else already logged

The rest of the known-deferred work was captured in
`wigl-widgets/LocalCode/AGENTS.md`'s "Backlog" section when the widget was
first built and is still accurate — branching (`/session/{id}/fork` exists
in `client.ts`'s reach, unused), sub-agent children view beyond the inline
badge, multi-monitor server sharing, and Ollama start/stop control
(virtualization is answered — see that log's render-window entry). Read that section instead of duplicating it here
— this file is for things that came up _after_ that log was written.
(Skill discovery, formerly listed here as unconfirmed, is now confirmed and
has its own entry: AGENTS.md's "Skills — disabled for now".)

### Housekeeper model — remaining consumers

**The "UI to pick the title model" part is closed**, on the owner's own
framing ("simplest to keep this a local JSON... device/user specific"): the
seed value is `DEFAULT_HOUSEKEEPER_MODEL` in
`wigl-widgets/LocalCode/config.ts`, persisted under
`STORAGE_KEYS.housekeeperModel`. Changing it is a one-line edit + rebuild,
which is the right cost for something set once per machine — a picker for it
would be permanent UI weight for a decision nobody revisits.

Still open: the *other* consumers. `housekeeper.ts` runs only
`generateSessionTitle()` today. Anything else small and local (summarizing a
long transcript before compaction, naming a fork) would reuse
`runHousekeeperPrompt()` — unspecified scope, not built.

### opencode `build` agent hangs against Ollama — real bug, real impact, not root-caused

**Found while fixing the flaky generation e2e test** (`wigl-widgets/LocalCode/tests/opencode.generation.e2e.test.ts`, now `test.skip`'d via a `BUILD_AGENT_OLLAMA_HANG` flag with this section referenced in the code comment). Not a wigl code bug — opencode/AI-SDK/Ollama plumbing — but it can hang a real chat turn in the real widget, so it's worth a session.

**Repro, verified live outside the test harness** (manual `opencode serve` +
raw `curl`, config written by hand to mirror what `opencodeConfig.ts`/the
test's `withDeterministicModels` produce):

- `POST /v1/chat/completions` straight to Ollama (no opencode) for
  `qwen3.5:0.8b`, prompt "What is 2+2? Reply with only the number.",
  `temperature: 0, seed: 42, options.num_predict: 256` → answers "4" in
  ~2s, `finish_reason: "stop"`.
- The exact same prompt/model/options, sent through opencode's
  `POST /session/{id}/message` with `agent: "build"` (the widget's default
  chat agent — no `agent` in a real session also resolves to this) → no
  response at all within a 90s `curl --max-time`, hundreds of
  `message.part.delta` SSE events (reasoning deltas) still streaming when
  the client gave up, no `session.idle`, no `session.error`.
- Ruled out model size as the variable: swapping to `qwen3.5:9b` (also
  pulled locally) reproduces the same indefinite hang through the `build`
  agent, despite the 9B model answering the same prompt correctly and
  quickly through plain Ollama.
- Also ruled out the prompt: an open-ended "say hello" and a closed-form
  "what is 2+2" both hang once `agent: "build"` is in the loop; both
  resolve fine without it.

**What this isolates it to**: something about the `build` agent's tool
schema / system prompt, specific to opencode's Ollama (`@ai-sdk/openai-
compatible`) provider path, not the model or the prompt. Two live
candidates, neither confirmed: (a) `options.num_predict` isn't actually
reaching Ollama through opencode's request construction the way it does in
a hand-built request, so generation runs uncapped; (b) the model attempts a
tool call, opencode's tool-loop handling doesn't terminate cleanly against
this provider, and it re-prompts indefinitely. Confirming either needs
instrumenting opencode's outgoing request (e.g. a local reverse proxy
between opencode and Ollama to capture the real request bodies) — out of
this repo, and enough of its own investigation to want a dedicated session
rather than a guess bolted onto this cleanup pass.

**User-facing exposure today**: `Composer.tsx`'s stop control (wired to
`session.abort`) does let a user cancel a hung turn, and the transcript now
shows a pending indicator for the whole wait — so it's not "stuck forever
with no way out", just "a turn can hang indefinitely with no error saying
why". Worth a session on its own once
someone can dedicate time to tracing the actual request opencode sends.

### Ollama model catalog — remaining rough edges

**Mostly done.** `wigl-widgets/LocalCode/opencodeConfig.ts` now syncs
Ollama's installed models into `~/.config/opencode/opencode.jsonc` before
`opencode serve` starts (`useOpencodeServer.ts`), and `useModelCatalog.ts`
filters the model picker to `ALLOWED_PROVIDER_IDS` (`config.ts`, currently
just `["ollama"]`) so opencode's always-on Zen provider no longer shows up
as if it were a real choice.

**Known gap**: config is read once at `opencode serve` startup — verified
live that editing the file while the server is already running has no
effect until restart (see AGENTS.md). So a model pulled via `ollama pull`
_while the widget is already running_ won't appear until the server
restarts — and there is no restart control in the UI at all anymore
(`useOpencodeServer`'s `restart()` exists but nothing calls it), so today
that means reloading the widget. A real fix would poll Ollama's
model list periodically, diff against what's already synced, and call
`useOpencodeServer`'s `restart()` automatically when it changes — not built
now because it adds a polling+diffing path for a case (pulling a new model
mid-session) that's easy enough to work around manually today.
