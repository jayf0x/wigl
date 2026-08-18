// Thin wrapper over opencode's HTTP API (see AGENTS.md — "Where the API
// shapes come from"), backed by the official generated client's `/v2`
// export (`@opencode-ai/sdk/v2` — the package's *default* export is a
// stale, different-vintage schema; `/v2` is the one verified live to match
// this repo's actual `opencode serve` output, endpoint by endpoint,
// including the `variant` field this widget's reasoning-effort chip
// depends on). The payoff over hand-rolled `fetch`: an opencode field
// rename now shows up as a `bun run typecheck` error here, not a silent
// runtime mismatch discovered by a user report. `subscribeEvents` is the
// one function still hand-rolled — see its own doc comment for why.
// The `/v2/client` subpath, not the bare `/v2` (or top-level) export —
// those re-export `./server.js` too, which pulls in `cross-spawn` (a
// Node-builtin-dependent process spawner for the SDK's own optional
// "spawn opencode for me" helper, `createOpencode()`, which this widget
// never uses — `serverProcess.ts` already owns spawning `opencode serve`
// through the host's own shell module). `cross-spawn` breaks widget
// bundling outright (`Bun.build` targets a browser environment, not
// Node/Bun — verified live: "Browser build cannot require() Node.js
// builtin: child_process"). `/v2/client` is client-only, confirmed no
// `cross-spawn`/`child_process` reference anywhere in its own module graph.
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { AgentDef, MessageWithParts, OpencodeEvent, OpencodeSession, ProviderCatalogEntry, Todo } from "./types";

const client = (baseUrl: string) => createOpencodeClient({ baseUrl });

/** Every generated-client call resolves `{ data, error }` rather than
 * throwing — unwraps into the same "resolves with data, throws with a real
 * message" contract every caller here already expects (what a hand-rolled
 * `fetch` + `!res.ok` check used to give). `error` is opencode's real
 * discriminated error union (`ProviderAuthError | UnknownError | ...`) —
 * deliberately not typed against that whole union here (every generated
 * request has a different error subset), and verified live that the union
 * isn't even internally consistent about where the message lives: most
 * variants are `{ name, data: { message } }`, but `SessionBusyError` (the
 * 409 a revert-mid-turn throws — see `revertToMessage`'s doc comment) is a
 * flat `{ _tag, message }` instead. Checked in priority order so either
 * shape's real text wins over the generic fallback. */
const unwrap = async <T>(result: Promise<{ data?: T; error?: unknown }>): Promise<T> => {
  const { data, error } = await result;
  if (error) {
    const e = error as { name?: string; _tag?: string; message?: string; data?: { message?: string } };
    throw new Error(`opencode API error: ${e.data?.message ?? e.message ?? e.name ?? e._tag ?? "unknown error"}`);
  }
  return data as T;
};

// `directory` matters: opencode's session store is global (one SQLite DB
// shared by every `opencode serve` invocation on the machine, keyed by
// project directory, not per-server-instance) — omitting it returns every
// session ever created for every project/directory anyone has ever pointed
// opencode at, not just this widget's own working directory. Verified live
// against a real opencode.db with 30+ sessions across multiple directories.
export const listSessions = (baseUrl: string, directory?: string): Promise<OpencodeSession[]> =>
  unwrap(client(baseUrl).session.list({ directory }));

// `opts.directory` is part of opencode's documented request shape but
// verified live to be silently ignored — the created session's real
// `directory` always matches the `serve` process's own cwd instead (see
// serverProcess.ts's `startOpencodeServer` doc comment). Still passed
// through here since the API declares it and a future opencode version
// may honor it; don't rely on it actually steering where a session lands.
export const createSession = (baseUrl: string, opts: { directory?: string; title?: string }): Promise<OpencodeSession> =>
  unwrap(client(baseUrl).session.create(opts));

export const renameSession = (baseUrl: string, sessionID: string, title: string): Promise<OpencodeSession> =>
  unwrap(client(baseUrl).session.update({ sessionID, title }));

export const deleteSession = (baseUrl: string, sessionID: string): Promise<void> =>
  unwrap(client(baseUrl).session.delete({ sessionID })).then(() => undefined);

export const abortSession = (baseUrl: string, sessionID: string): Promise<void> =>
  unwrap(client(baseUrl).session.abort({ sessionID })).then(() => undefined);

export const listMessages = (baseUrl: string, sessionID: string): Promise<MessageWithParts[]> =>
  unwrap(client(baseUrl).session.messages({ sessionID }));

export interface SendPromptOpts {
  text: string;
  model?: { providerID: string; modelID: string };
  agent?: string;
  variant?: string;
  messageID?: string;
}

// Fire-and-forget: the reply streams in over SSE (`message.part.updated`
// etc.), this call only confirms the turn started.
export const sendPrompt = (baseUrl: string, sessionID: string, opts: SendPromptOpts): Promise<void> =>
  unwrap(
    client(baseUrl).session.promptAsync({
      sessionID,
      messageID: opts.messageID,
      model: opts.model,
      agent: opts.agent,
      variant: opts.variant,
      parts: [{ type: "text", text: opts.text }],
    }),
  ).then(() => undefined);

// "Edit a question" = revert the session back to that message (undoing its
// effects, per opencode's own semantics) then send the corrected prompt as
// a fresh turn — there's no separate "edit" endpoint, this is the intended
// composition of `revert` + `prompt_async` (see AGENTS.md).
export const revertToMessage = (baseUrl: string, sessionID: string, messageID: string): Promise<OpencodeSession> =>
  unwrap(client(baseUrl).session.revert({ sessionID, messageID }));

export const replyPermission = (
  baseUrl: string,
  requestID: string,
  reply: "once" | "always" | "reject",
): Promise<void> => unwrap(client(baseUrl).permission.reply({ requestID, reply })).then(() => undefined);

export const listAgents = (baseUrl: string): Promise<AgentDef[]> => unwrap(client(baseUrl).app.agents({}));

export const listProviders = (baseUrl: string): Promise<{ providers: ProviderCatalogEntry[] }> =>
  unwrap(client(baseUrl).config.providers({}));

export const listTodos = (baseUrl: string, sessionID: string): Promise<Todo[]> =>
  unwrap(client(baseUrl).session.todo({ sessionID }));

/** Subscribes to opencode's global SSE event stream. Returns an unsubscribe
 * function. `onEvent` receives every event this widget knows about (see
 * `OpencodeEvent` in types.ts); unrecognized `type`s are silently dropped by
 * the JSON parse's caller, not filtered here, so a future opencode release
 * adding new event types never throws — it just does nothing yet.
 *
 * Deliberately still plain `EventSource`, not the generated client's own
 * `event.subscribe()` — that one streams by piping `response.body` through
 * a `ReadableStream` reader (`fetch` + manual chunk parsing), not the
 * native `EventSource` API. `EventSource` is a standard, guaranteed-
 * incremental browser primitive; a hand-rolled fetch-stream reader risks
 * a WebKit buffering gap (historically real on WKWebView specifically —
 * the actual runtime this app ships on, on macOS) where the body only
 * delivers once the full response finishes, not incrementally. That would
 * turn every streaming reply into "nothing, then the whole thing at once"
 * — not verified broken here, but not worth risking against the one thing
 * this widget's whole live-chat UX depends on, for a component the
 * generated client makes optional to swap in the first place. */
export const subscribeEvents = (baseUrl: string, onEvent: (event: OpencodeEvent) => void): (() => void) => {
  const source = new EventSource(`${baseUrl}/event`);
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as OpencodeEvent);
    } catch (e) {
      console.error("[LocalCode] failed to parse opencode event", e);
    }
  };
  return () => source.close();
};
