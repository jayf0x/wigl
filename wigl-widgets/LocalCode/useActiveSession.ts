// Transcript + live state for exactly one session: messages, their parts,
// pending permission requests, and the agent's todo list. Durable content
// (finished messages/parts) comes from the initial REST fetch; everything
// after that is applied from SSE events — see AGENTS.md's "durable vs.
// transient" note for why parts are updated in place rather than replayed
// wholesale on every event.
import { useCallback, useEffect, useRef, useState } from "react";
import { useStorage } from "@/wigl/hooks";
import * as client from "./client";
import { STORAGE_KEYS } from "./config";
import { applyEvent, emptySessionState, type SessionState } from "./eventReducer";
import { generateSessionTitle } from "./housekeeper";
import { endsInLoop } from "./repetition";
import type { MessageWithParts, ModelSelection } from "./types";

export interface HousekeeperContext {
  model: ModelSelection;
  directory: string;
  onTitle: (sessionID: string, title: string) => void;
}

export const useActiveSession = (
  baseUrl: string | null,
  sessionID: string | null,
  housekeeper?: HousekeeperContext,
) => {
  const [state, setState] = useState<SessionState>(emptySessionState);
  const [loading, setLoading] = useState(false);
  const [lastModel, setLastModel] = useStorage<ModelSelection | null>(STORAGE_KEYS.lastModel, null);
  const [lastAgent, setLastAgent] = useStorage<string | null>(STORAGE_KEYS.lastAgent, null);
  const [lastVariant, setLastVariant] = useStorage<string | null>(STORAGE_KEYS.lastVariant, null);

  useEffect(() => {
    setState(emptySessionState());
    if (!baseUrl || !sessionID) return;
    setLoading(true);
    Promise.all([client.listMessages(baseUrl, sessionID), client.listTodos(baseUrl, sessionID)])
      .then(([msgs, td]) => setState((prev) => ({ ...prev, messages: msgs, todos: td })))
      .catch((e) => console.error("[LocalCode] failed to load session", e))
      .finally(() => setLoading(false));
  }, [baseUrl, sessionID]);

  useEffect(() => {
    if (!baseUrl || !sessionID) return;
    return client.subscribeEvents(baseUrl, (event) => {
      setState((prev) => applyEvent(prev, event, sessionID));
    });
  }, [baseUrl, sessionID]);

  // Mirrors `state.messages` for `send()` to read synchronously without
  // becoming a dependency of it (an array that gets a new reference on
  // every SSE event would otherwise recreate `send` constantly).
  const messagesRef = useRef<MessageWithParts[]>([]);
  useEffect(() => {
    messagesRef.current = state.messages;
  }, [state.messages]);

  const send = useCallback(
    async (text: string, opts?: { model?: ModelSelection; agent?: string; variant?: string }) => {
      if (!baseUrl || !sessionID || !text.trim()) return;
      const model = opts?.model ?? lastModel ?? undefined;
      const agent = opts?.agent ?? lastAgent ?? undefined;
      const variant = opts?.variant ?? lastVariant ?? undefined;
      if (opts?.model) setLastModel(opts.model);
      if (opts?.agent) setLastAgent(opts.agent);
      if (opts?.variant !== undefined) setLastVariant(opts.variant);
      const isFirstMessage = messagesRef.current.length === 0;
      setState((prev) => ({ ...prev, busy: true, error: null }));
      await client.sendPrompt(baseUrl, sessionID, { text, model, agent, variant });
      // Fire-and-forget: a title arriving a few seconds late is fine, the
      // turn itself must never wait on the housekeeper model.
      if (isFirstMessage && housekeeper) {
        generateSessionTitle(baseUrl, housekeeper.model, text, housekeeper.directory)
          .then((title) => title && housekeeper.onTitle(sessionID, title))
          .catch((e) => console.error("[LocalCode] session auto-title failed", e));
      }
    },
    [baseUrl, sessionID, lastModel, lastAgent, lastVariant, setLastModel, setLastAgent, setLastVariant, housekeeper],
  );

  // Edit-and-resend: revert to the target message (undoes its effects
  // server-side per opencode's own semantics), then send the corrected text
  // as a new turn. There's no dedicated "edit" endpoint — see client.ts.
  //
  // opencode rejects a revert while the session is already generating
  // (`409 SessionBusyError`, verified live) — `MessageList.tsx` disables
  // the edit trigger whenever `busy` is true so this shouldn't normally be
  // reachable, but the catch here is defense in depth against the race
  // (busy flips true between a click and this call landing) rather than an
  // unhandled rejection with no visible feedback.
  const editAndResend = useCallback(
    async (messageID: string, newText: string) => {
      if (!baseUrl || !sessionID) return;
      try {
        await client.revertToMessage(baseUrl, sessionID, messageID);
      } catch (e) {
        setState((prev) => ({ ...prev, error: e instanceof Error ? e.message : "failed to revert message" }));
        return;
      }
      setState((prev) => {
        const idx = prev.messages.findIndex((m) => m.info.id === messageID);
        return idx === -1 ? prev : { ...prev, messages: prev.messages.slice(0, idx) };
      });
      await send(newText);
    },
    [baseUrl, sessionID, send],
  );

  const replyPermission = useCallback(
    (requestID: string, reply: "once" | "always" | "reject") => {
      if (!baseUrl) return;
      setState((prev) => ({ ...prev, permissions: prev.permissions.filter((p) => p.id !== requestID) }));
      client.replyPermission(baseUrl, requestID, reply).catch((e) => console.error(e));
    },
    [baseUrl],
  );

  const abort = useCallback(() => {
    if (baseUrl && sessionID) client.abortSession(baseUrl, sessionID).catch((e) => console.error(e));
  }, [baseUrl, sessionID]);

  const dismissError = useCallback(() => setState((prev) => ({ ...prev, error: null })), []);

  // Runaway-loop guard. A small local model that starts restating the same
  // phrase generally never stops on its own (see TODO.md's `build`-agent hang
  // entry for a related failure) — it just burns GPU until someone notices.
  // `endsInLoop` is deliberately strict (see repetition.ts) because the
  // consequence here is killing a real turn. Reasoning text counts: that's
  // where the spiral usually happens, and it's collapsed by default, so
  // nobody would see it.
  useEffect(() => {
    if (!state.busy) return;
    const last = state.messages.at(-1);
    if (last?.info.role !== "assistant") return;
    const streamed = last.parts
      .filter((p) => p.type === "text" || p.type === "reasoning")
      .map((p) => p.text ?? "")
      .join("\n");
    if (!endsInLoop(streamed)) return;
    abort();
    setState((prev) => ({ ...prev, busy: false, error: "stopped — the model was repeating itself" }));
  }, [state.messages, state.busy, abort]);

  return {
    messages: state.messages,
    permissions: state.permissions,
    todos: state.todos,
    busy: state.busy,
    error: state.error,
    dismissError,
    loading,
    send,
    editAndResend,
    replyPermission,
    abort,
    lastModel,
    lastAgent,
    lastVariant,
    setLastModel,
    setLastAgent,
    setLastVariant,
  };
};
