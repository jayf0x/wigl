// Pure reducer for applying opencode SSE events to one session's transcript
// state — extracted out of useActiveSession.ts so the exact logic deciding
// "does this event make a reply appear" is unit-testable without a React
// runtime (see docs/principles.md's functional-core/imperative-shell rule).
// The hook stays a thin subscribe-and-setState wrapper around `applyEvent`.
import type { MessagePart, MessageWithParts, OpencodeEvent, PermissionRequest, Todo } from "./types";

export interface SessionState {
  messages: MessageWithParts[];
  permissions: PermissionRequest[];
  todos: Todo[];
  busy: boolean;
  error: string | null;
}

export const emptySessionState = (): SessionState => ({
  messages: [],
  permissions: [],
  todos: [],
  busy: false,
  error: null,
});

const upsertPart = (messages: MessageWithParts[], part: MessagePart): MessageWithParts[] => {
  const idx = messages.findIndex((m) => m.info.id === part.messageID);
  if (idx === -1) return messages;
  const parts = messages[idx].parts;
  const partIdx = parts.findIndex((p) => p.id === part.id);
  const nextParts = partIdx === -1 ? [...parts, part] : parts.map((p, i) => (i === partIdx ? part : p));
  return messages.map((m, i) => (i === idx ? { ...m, parts: nextParts } : m));
};

/** Applies one SSE event to `state`, scoped to `sessionID` (events for any
 * other session are no-ops). Events this widget doesn't react to fall
 * through unchanged — see client.ts's `subscribeEvents` for why an unknown
 * `type` must never throw. */
export const applyEvent = (state: SessionState, event: OpencodeEvent, sessionID: string): SessionState => {
  switch (event.type) {
    case "message.updated": {
      const info = event.properties.info;
      if (info.sessionID !== sessionID) return state;
      const idx = state.messages.findIndex((m) => m.info.id === info.id);
      const messages =
        idx === -1
          ? [...state.messages, { info, parts: [] }]
          : state.messages.map((m, i) => (i === idx ? { ...m, info } : m));
      return { ...state, messages };
    }
    case "message.removed": {
      if (event.properties.sessionID !== sessionID) return state;
      return { ...state, messages: state.messages.filter((m) => m.info.id !== event.properties.messageID) };
    }
    case "message.part.updated": {
      const part = event.properties.part;
      if (part.sessionID !== sessionID) return state;
      return { ...state, messages: upsertPart(state.messages, part) };
    }
    case "message.part.removed": {
      const { sessionID: sid, messageID, partID } = event.properties;
      if (sid !== sessionID) return state;
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.info.id === messageID ? { ...m, parts: m.parts.filter((p) => p.id !== partID) } : m,
        ),
      };
    }
    case "permission.asked":
      if (event.properties.sessionID !== sessionID) return state;
      return { ...state, permissions: [...state.permissions, event.properties] };
    case "permission.replied":
      if (event.properties.sessionID !== sessionID) return state;
      return { ...state, permissions: state.permissions.filter((p) => p.id !== event.properties.permissionID) };
    case "todo.updated":
      if (event.properties.sessionID !== sessionID) return state;
      return { ...state, todos: event.properties.todos };
    // A turn failing (bad model, provider unreachable, ...) never produces
    // an assistant message — surfacing it here is the difference between
    // "reply silently never arrives" and a visible error. See TODO.md /
    // AGENTS.md for the live-server trace that found this gap.
    case "session.error": {
      if (event.properties.sessionID !== undefined && event.properties.sessionID !== sessionID) return state;
      const message = event.properties.error?.data?.message ?? "the agent hit an error";
      return { ...state, busy: false, error: message };
    }
    case "session.idle":
      if (event.properties.sessionID !== sessionID) return state;
      return { ...state, busy: false };
    default:
      return state;
  }
};
