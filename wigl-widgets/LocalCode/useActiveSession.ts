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
import { generateSessionTitle } from "./housekeeper";
import type { MessagePart, MessageWithParts, ModelSelection, PermissionRequest, Todo } from "./types";

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
  const [messages, setMessages] = useState<MessageWithParts[]>([]);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastModel, setLastModel] = useStorage<ModelSelection | null>(STORAGE_KEYS.lastModel, null);
  const [lastAgent, setLastAgent] = useStorage<string | null>(STORAGE_KEYS.lastAgent, null);
  const [lastVariant, setLastVariant] = useStorage<string | null>(STORAGE_KEYS.lastVariant, null);

  useEffect(() => {
    setMessages([]);
    setPermissions([]);
    setTodos([]);
    if (!baseUrl || !sessionID) return;
    setLoading(true);
    Promise.all([client.listMessages(baseUrl, sessionID), client.listTodos(baseUrl, sessionID)])
      .then(([msgs, td]) => {
        setMessages(msgs);
        setTodos(td);
      })
      .catch((e) => console.error("[LocalCode] failed to load session", e))
      .finally(() => setLoading(false));
  }, [baseUrl, sessionID]);

  useEffect(() => {
    if (!baseUrl || !sessionID) return;
    const upsertPart = (part: MessagePart) => {
      if (part.sessionID !== sessionID) return;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.info.id === part.messageID);
        if (idx === -1) return prev;
        const parts = prev[idx].parts;
        const partIdx = parts.findIndex((p) => p.id === part.id);
        const nextParts = partIdx === -1 ? [...parts, part] : parts.map((p, i) => (i === partIdx ? part : p));
        return prev.map((m, i) => (i === idx ? { ...m, parts: nextParts } : m));
      });
    };

    return client.subscribeEvents(baseUrl, (event) => {
      switch (event.type) {
        case "message.updated": {
          const info = event.properties.info;
          if (info.sessionID !== sessionID) return;
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.info.id === info.id);
            if (idx === -1) return [...prev, { info, parts: [] }];
            return prev.map((m, i) => (i === idx ? { ...m, info } : m));
          });
          return;
        }
        case "message.removed": {
          if (event.properties.sessionID !== sessionID) return;
          setMessages((prev) => prev.filter((m) => m.info.id !== event.properties.messageID));
          return;
        }
        case "message.part.updated":
          upsertPart(event.properties.part);
          return;
        case "message.part.removed": {
          const { sessionID: sid, messageID, partID } = event.properties;
          if (sid !== sessionID) return;
          setMessages((prev) =>
            prev.map((m) => (m.info.id === messageID ? { ...m, parts: m.parts.filter((p) => p.id !== partID) } : m)),
          );
          return;
        }
        case "permission.asked":
          if (event.properties.sessionID === sessionID) setPermissions((prev) => [...prev, event.properties]);
          return;
        case "permission.replied":
          if (event.properties.sessionID === sessionID)
            setPermissions((prev) => prev.filter((p) => p.id !== event.properties.permissionID));
          return;
        case "todo.updated":
          if (event.properties.sessionID === sessionID) setTodos(event.properties.todos);
          return;
        default:
          return;
      }
    });
  }, [baseUrl, sessionID]);

  // Mirrors `messages` for `send()` to read synchronously without becoming
  // a dependency of it (an array that gets a new reference on every SSE
  // event would otherwise recreate `send` constantly).
  const messagesRef = useRef<MessageWithParts[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
  const editAndResend = useCallback(
    async (messageID: string, newText: string) => {
      if (!baseUrl || !sessionID) return;
      await client.revertToMessage(baseUrl, sessionID, messageID);
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.info.id === messageID);
        return idx === -1 ? prev : prev.slice(0, idx);
      });
      await send(newText);
    },
    [baseUrl, sessionID, send],
  );

  const replyPermission = useCallback(
    (requestID: string, reply: "once" | "always" | "reject") => {
      if (!baseUrl) return;
      setPermissions((prev) => prev.filter((p) => p.id !== requestID));
      client.replyPermission(baseUrl, requestID, reply).catch((e) => console.error(e));
    },
    [baseUrl],
  );

  const abort = useCallback(() => {
    if (baseUrl && sessionID) client.abortSession(baseUrl, sessionID).catch((e) => console.error(e));
  }, [baseUrl, sessionID]);

  return {
    messages,
    permissions,
    todos,
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
