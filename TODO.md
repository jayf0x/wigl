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
functional sidebar + transcript + composer + status bar, built with
existing coss-ui primitives (`Button`, `Input`, `Select`, `Textarea`,
`ScrollArea`) but no layout/spacing/hierarchy pass. `docs/theming.md` has
wigl's token contract (no hardcoded colors) — the redesign must stay inside
that, not introduce ad-hoc colors.

## 2. Regression tests against opencode API drift

**Not started — owner explicitly flagged this as delegate-worthy**, not
something to fold into a feature session: "need to write tests for basics
so that we are certain the widget does not break on OpenCode updates. This
sounds also like a delegated task to me."

Context for whoever picks this up: `wigl-widgets/LocalCode/client.ts` is a
thin `fetch`/`EventSource` wrapper over opencode's HTTP API. There's no
official TypeScript SDK dependency here — the shapes in `types.ts` were
hand-verified against a **live `opencode serve` v1.18.15** instance during
the original build (see AGENTS.md's "Where the API shapes come from"). A
future `opencode` upgrade silently changing a field name or endpoint shape
would break this widget with no compile-time signal, since `types.ts` is
just asserted, not generated or checked against anything real.

What "tests for basics" should mean here: a small script (repo convention:
`scripts/`, one-line `package.json` entry, see `calendar:add`/`repos:scan`
for the pattern) that spins up a real local `opencode serve`, exercises the
same endpoints `client.ts` calls (create/list/rename/delete session, send a
prompt to a trivial model, read it back, revert), and asserts the response
shapes match what `types.ts` expects. Needs a real model to prompt against
— `ollama/smollm:135m` (see below) is the obvious cheap/local choice, no
API key, no cost. This is closer to an integration smoke test than a unit
test suite; there's nothing to meaningfully mock here since the entire risk
is "does the real API still look like we think it does."

## 3. Housekeeper model — remaining consumers

**Partially done.** `wigl-widgets/LocalCode/housekeeper.ts` now exists:
`runHousekeeperPrompt(baseUrl, model, prompt, directory)` runs a prompt
against a throwaway session on a small model (default
`ollama/smollm:135m`, configurable via the `localcode_housekeeper_model`
storage key, `DEFAULT_HOUSEKEEPER_MODEL` in `config.ts`) and returns the
text response, cleaning up the scratch session afterward.

**Wired today**: session auto-naming — `generateSessionTitle()` fires on a
session's first user message (`useActiveSession.ts`'s `send()`), renames
the session in place once it resolves. Fire-and-forget; a slow/failed
housekeeper call just leaves the truncated-prompt fallback title.

**Not wired yet** (owner's own list: "generating a greeting message, naming
sessions, other possible small tasks and to run e2e tests" — naming is
done, the rest isn't):

- **Greeting message** — no concrete spec for what this greets on (widget
  mount? new empty session?) or where it renders. Needs a product decision
  before it's a coding task, not just a missing function call.
- **Other small tasks** — genuinely unspecified by the owner ("other
  possible small tasks"). Don't invent scope; wait for a concrete ask.
- **E2e test runner using the housekeeper model** — this likely overlaps
  heavily with item 2 above (regression tests would want a cheap local
  model to prompt against, which is exactly what the housekeeper model is
  for). Worth doing as one piece of work, not two.
- **Housekeeper model picker in the UI** — right now it's configurable only
  by editing the `localcode_housekeeper_model` key directly (`useStorage`,
  shared sqlite `kv` table — see `docs/widgets.md`). No UI control exists.
  Low priority until someone actually wants a non-default housekeeper model.

## 4. Ollama model catalog — remaining rough edges

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

## 5. Everything else already logged

The rest of the known-deferred work was captured in
`wigl-widgets/LocalCode/AGENTS.md`'s "Backlog" section when the widget was
first built and is still accurate — branching (`/session/{id}/fork` exists
in `client.ts`'s reach, unused), skill discovery verification (opencode may
already read `SKILL.md` off disk with zero widget code — unconfirmed),
sub-agent children view beyond the inline badge, message-list
virtualization, multi-monitor server sharing, and Ollama start/stop control.
Read that section instead of duplicating it here — this file is for things
that came up *after* that log was written.
