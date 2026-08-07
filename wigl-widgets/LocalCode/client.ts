// Thin wrapper over opencode's HTTP API (see AGENTS.md — "Where the API
// shapes come from"). Plain `fetch`/`EventSource` against the local server
// spawned by serverProcess.ts, not a generated SDK — the surface we use is
// small enough that a client generator would be more ceremony than the
// eleven functions below.
import type { AgentDef, MessageWithParts, OpencodeEvent, OpencodeSession, ProviderCatalogEntry, Todo } from "./types";

const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) throw new Error(`opencode API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  return res.json() as Promise<T>;
};

export const listSessions = (baseUrl: string): Promise<OpencodeSession[]> =>
  fetch(`${baseUrl}/session`).then((r) => json(r));

export const createSession = (baseUrl: string, opts: { directory?: string; title?: string }): Promise<OpencodeSession> =>
  fetch(`${baseUrl}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  }).then((r) => json(r));

export const renameSession = (baseUrl: string, sessionID: string, title: string): Promise<OpencodeSession> =>
  fetch(`${baseUrl}/session/${sessionID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  }).then((r) => json(r));

export const deleteSession = (baseUrl: string, sessionID: string): Promise<void> =>
  fetch(`${baseUrl}/session/${sessionID}`, { method: "DELETE" }).then(() => undefined);

export const abortSession = (baseUrl: string, sessionID: string): Promise<void> =>
  fetch(`${baseUrl}/session/${sessionID}/abort`, { method: "POST" }).then(() => undefined);

export const listMessages = (baseUrl: string, sessionID: string): Promise<MessageWithParts[]> =>
  fetch(`${baseUrl}/session/${sessionID}/message`).then((r) => json(r));

export interface SendPromptOpts {
  text: string;
  model?: { providerID: string; modelID: string };
  agent?: string;
  variant?: string;
  messageID?: string;
}

// Fire-and-forget: the reply streams in over SSE (`message.part.updated`
// etc.), this call only confirms the turn started. Use `sendPromptAwait`
// instead for the rare case a caller needs the finished message inline.
export const sendPrompt = (baseUrl: string, sessionID: string, opts: SendPromptOpts): Promise<void> =>
  fetch(`${baseUrl}/session/${sessionID}/prompt_async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messageID: opts.messageID,
      model: opts.model,
      agent: opts.agent,
      variant: opts.variant,
      parts: [{ type: "text", text: opts.text }],
    }),
  }).then((r) => {
    if (!r.ok) throw new Error(`opencode API ${r.status}`);
  });

// "Edit a question" = revert the session back to that message (undoing its
// effects, per opencode's own semantics) then send the corrected prompt as
// a fresh turn — there's no separate "edit" endpoint, this is the intended
// composition of `revert` + `prompt_async` (see AGENTS.md).
export const revertToMessage = (baseUrl: string, sessionID: string, messageID: string): Promise<OpencodeSession> =>
  fetch(`${baseUrl}/session/${sessionID}/revert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageID }),
  }).then((r) => json(r));

export const replyPermission = (
  baseUrl: string,
  requestID: string,
  reply: "once" | "always" | "reject",
): Promise<void> =>
  fetch(`${baseUrl}/permission/${requestID}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply }),
  }).then(() => undefined);

export const listAgents = (baseUrl: string): Promise<AgentDef[]> => fetch(`${baseUrl}/agent`).then((r) => json(r));

export const listProviders = (baseUrl: string): Promise<{ providers: ProviderCatalogEntry[] }> =>
  fetch(`${baseUrl}/config/providers`).then((r) => json(r));

export const listTodos = (baseUrl: string, sessionID: string): Promise<Todo[]> =>
  fetch(`${baseUrl}/session/${sessionID}/todo`).then((r) => json(r));

/** Subscribes to opencode's global SSE event stream. Returns an unsubscribe
 * function. `onEvent` receives every event this widget knows about (see
 * `OpencodeEvent` in types.ts); unrecognized `type`s are silently dropped by
 * the JSON parse's caller, not filtered here, so a future opencode release
 * adding new event types never throws — it just does nothing yet. */
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
