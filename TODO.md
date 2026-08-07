# TODO — LocalCode

Deferred/delegated work for the `LocalCode` widget (`wigl-widgets/LocalCode/`)
— a chat UI for driving local coding agents (opencode + Ollama today, Claude
Code later). Each entry below is self-contained: enough context to start
without re-reading the whole build session, not a re-explanation of the
whole widget. Read `wigl-widgets/LocalCode/AGENTS.md` first regardless —
it's short and has the load-bearing facts (API shapes, server lifecycle,
decisions log) every entry here assumes you already know.

Delete an entry when it's done — this file isn't a changelog.

## 1. UI redesign — separate session, once core is stable

**Not started.** Owner feedback verbatim: "the UI is really sucky and ugly.
Needs redesign. Inputs are ugly, no special styling... looked made by a
student at first sight... Might be good for a separate session only on the
design once the core is stable." Explicitly scoped out of the functional
work — don't attempt inline touch-ups as part of an unrelated fix, do a real
design pass.

Current state to design against: `wigl-widgets/LocalCode/components/` — a
functional sidebar + transcript + composer (no status bar anymore, see item
6 below), built with existing coss-ui primitives (`Button`, `Input`,
`Select`, `Textarea`, `ScrollArea`) but no layout/spacing/hierarchy pass.
`docs/theming.md` has wigl's token contract (no hardcoded colors) — the
redesign must stay inside that, not introduce ad-hoc colors.

## 2. Housekeeper model — remaining consumers

**Partially done.** `wigl-widgets/LocalCode/housekeeper.ts` now exists:
`runHousekeeperPrompt(baseUrl, model, prompt, directory, agent?)` runs a
prompt against a throwaway session on a small model (default
`ollama/smollm:135m`, configurable via the `localcode_housekeeper_model`
storage key, `DEFAULT_HOUSEKEEPER_MODEL` in `config.ts`) and returns the
text response, cleaning up the scratch session afterward. Pass a toolless
native `agent` (e.g. `"title"`) for any plain text-in/text-out task — a
session with no `agent` defaults to `"build"`, which always attaches
opencode's tool schema, and small models without function-calling support
(`smollm:135m` included) 400 with "does not support tools" — see the doc
comment on `runHousekeeperPrompt`.

**Wired today**: session auto-naming — `generateSessionTitle()` fires on a
session's first user message (`useActiveSession.ts`'s `send()`), renames
the session in place once it resolves. Fire-and-forget; a slow/failed
housekeeper call just leaves the truncated-prompt fallback title.
Regression/e2e coverage against a real housekeeper-model call lives in
`wigl-widgets/LocalCode/tests/opencode.e2e.test.ts` (`wigl test widgets`).

**Not wired yet** (owner's own list: "generating a greeting message, naming
sessions, other possible small tasks" — naming is done, the rest isn't):

- **Greeting message** — no concrete spec for what this greets on (widget
  mount? new empty session?) or where it renders. Needs a product decision
  before it's a coding task, not just a missing function call.
- **Other small tasks** — genuinely unspecified by the owner ("other
  possible small tasks"). Don't invent scope; wait for a concrete ask.
- **Housekeeper model picker in the UI** — right now it's configurable only
  by editing the `localcode_housekeeper_model` key directly (`useStorage`,
  shared sqlite `kv` table — see `docs/widgets.md`). No UI control exists.
  Low priority until someone actually wants a non-default housekeeper model.

## 3. Ollama model catalog — remaining rough edges

**Mostly done.** `wigl-widgets/LocalCode/opencodeConfig.ts` now syncs
Ollama's installed models into `~/.config/opencode/opencode.jsonc` before
`opencode serve` starts (`useOpencodeServer.ts`), and `useModelCatalog.ts`
filters the model picker to `ALLOWED_PROVIDER_IDS` (`config.ts`, currently
just `["ollama"]`) so opencode's always-on Zen provider no longer shows up
as if it were a real choice.

**Known gap**: config is read once at `opencode serve` startup — verified
live that editing the file while the server is already running has no
effect until restart (see AGENTS.md). So a model pulled via `ollama pull`
*while the widget is already running* won't appear until the user clicks
the restart button in `ServerStatusBar.tsx`. A real fix would poll Ollama's
model list periodically, diff against what's already synced, and call
`useOpencodeServer`'s `restart()` automatically when it changes — not built
now because it adds a polling+diffing path for a case (pulling a new model
mid-session) that's easy enough to work around manually today.

## 4. opencode `build` agent hangs against Ollama — real bug, real impact, not root-caused

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

**User-facing exposure today**: the existing abort button
(`ServerStatusBar`/`Composer`'s stop control, wired to `session.abort`)
does let a user cancel a hung turn — this isn't a "the widget is stuck
forever with no way out" bug, just a "a turn can hang with no error and no
progress indicator explaining why" one. Worth a session on its own once
someone can dedicate time to tracing the actual request opencode sends.

## 5. No progress/status indicator while a turn is generating

**Confirmed missing UI, not a state bug.** `useActiveSession.ts`'s `busy`
flag is tracked correctly (set on `send()`, cleared on `session.idle`/
`session.error` — see `eventReducer.ts`) and does reach the UI: `Composer.tsx`
swaps its send button for a stop button while `busy`, and `MessageList.tsx`
disables the edit-and-resend pencil on user messages while `busy`. But
nothing in `MessageList.tsx` itself renders any loading/"generating…"
indicator in the transcript — between the user hitting send and the first
SSE part actually arriving (creating the assistant message bubble), the
transcript shows nothing at all except whatever's already there. The stop
button is the only visible signal, and it's easy to miss since it's a
small icon swap in the composer, not in the area the user is actually
looking at (the transcript).

Not fixed here — this is UI work, same bucket as item 1's redesign. Fix
shape when it's picked up: a lightweight "thinking…"/typing-indicator
bubble in `MessageList.tsx`, shown whenever `busy` is true and there's no
assistant message yet for the current turn (or the assistant message
exists but has no parts yet) — driven entirely by state that already
exists, no new plumbing needed.

## 6. Ollama/opencode status polling removed — needs a real error surface instead

**Removed** (see git history for `ServerStatusBar.tsx`/`ollama.ts`):
continuous polling of Ollama's `/api/tags` (`useOllamaStatus`, every 10s)
purely to light up a status dot, and the always-visible "opencode ●
ollama ●" status bar itself. Owner feedback: the polling wasn't
accomplishing anything a user needed moment-to-moment, and the UI making a
permanent fixture out of "yep, still there" was noise — "less is more."

**What's still needed, not built**: when something actually *is* broken
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

## 7. Everything else already logged

The rest of the known-deferred work was captured in
`wigl-widgets/LocalCode/AGENTS.md`'s "Backlog" section when the widget was
first built and is still accurate — branching (`/session/{id}/fork` exists
in `client.ts`'s reach, unused), sub-agent children view beyond the inline
badge, message-list virtualization, multi-monitor server sharing, and
Ollama start/stop control. Read that section instead of duplicating it here
— this file is for things that came up *after* that log was written.
(Skill discovery, formerly listed here as unconfirmed, is now confirmed and
has its own entry: AGENTS.md's "Skills — disabled for now".)
