// Trimmed mirror of opencode's HTTP API shapes (see AGENTS.md — "Where the
// API shapes come from"). Only the fields this widget actually reads/writes
// are declared; the real objects have more, `[key: string]: unknown` isn't
// needed since we never round-trip a whole object back to the server.

export interface OpencodeSession {
  id: string;
  projectID: string;
  directory: string;
  parentID?: string;
  title: string;
  time: { created: number; updated: number };
}

export type PartType =
  | "text"
  | "reasoning"
  | "tool"
  | "step-start"
  | "step-finish"
  | "agent"
  | "subtask"
  | "patch"
  | "snapshot"
  | "retry"
  | "compaction"
  | "file";

export interface MessagePart {
  id: string;
  sessionID: string;
  messageID: string;
  type: PartType;
  // text / reasoning
  text?: string;
  // `created` only appears on a real `RetryPart`, not read by this widget
  // (see AGENTS.md) — declared just so the field doesn't conflict with the
  // real per-part-type union when assigning from client.ts.
  time?: { start?: number; end?: number; created?: number };
  // tool
  tool?: string;
  callID?: string;
  state?: { status: "pending" | "running" | "completed" | "error"; input?: unknown; output?: string; error?: string };
  // subtask (sub-agent spawn)
  prompt?: string;
  description?: string;
  agent?: string;
  // patch (file edit summary — no diff rendering, just "N files changed")
  files?: string[];
}

export interface OpencodeMessage {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
  time: { created: number; completed?: number };
  modelID?: string;
  providerID?: string;
  // opencode's real error shape (verified against @opencode-ai/sdk/v2's
  // generated types): a discriminated union of error kinds, message text
  // nested under `data`, not flat — some variants (`MessageOutputLengthError`)
  // don't guarantee a `message` at all, hence both levels optional.
  error?: { name?: string; data?: { message?: string } };
}

export interface MessageWithParts {
  info: OpencodeMessage;
  parts: MessagePart[];
}

export interface PermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  tool?: { messageID: string; callID: string };
}

export interface Todo {
  content: string;
  // opencode's own schema doesn't constrain these beyond `string` at the
  // type level (verified against @opencode-ai/sdk/v2) — this widget only
  // ever reads `todos.length` (see AGENTS.md), never branches on a
  // specific value, so there's nothing here that needs the tighter literal
  // union to catch.
  status: string;
  priority: string;
}

export interface AgentDef {
  name: string;
  description?: string;
  mode: "primary" | "subagent" | "all";
  model?: { providerID: string; modelID: string };
  /** opencode's own marker for internal-use agents (its native `title`,
   * `summary`, `compaction`) — never meant to be chosen directly. */
  hidden?: boolean;
}

export interface ProviderModel {
  id: string;
  providerID: string;
  name: string;
  capabilities: { reasoning: boolean; toolcall: boolean };
  // Real shape is an open bag per variant (verified against
  // @opencode-ai/sdk/v2) — this widget only ever reads the *keys* (see
  // Composer.tsx), never a variant's own fields, so nothing here needs a
  // named shape for values it doesn't touch.
  variants?: Record<string, unknown>
}

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  models: Record<string, ProviderModel>;
}

export interface ModelSelection {
  providerID: string;
  modelID: string;
}

// The subset of opencode's `Event` union this widget reacts to — every SSE
// message not matching one of these `type`s is ignored (see client.ts's
// `subscribeEvents`), so adding a new reaction is "add a case", not "change
// the parse".
export type OpencodeEvent =
  | { type: "session.created"; properties: { info: OpencodeSession } }
  | { type: "session.updated"; properties: { info: OpencodeSession } }
  | { type: "session.deleted"; properties: { info: OpencodeSession } }
  | { type: "session.idle"; properties: { sessionID: string } }
  | {
      type: "session.error";
      properties: { sessionID?: string; error?: { name?: string; data?: { message?: string } } };
    }
  | { type: "message.updated"; properties: { info: OpencodeMessage } }
  | { type: "message.removed"; properties: { sessionID: string; messageID: string } }
  | { type: "message.part.updated"; properties: { part: MessagePart; delta?: string } }
  | {
      type: "message.part.delta";
      properties: { sessionID: string; messageID: string; partID: string; field: "text"; delta: string };
    }
  | { type: "message.part.removed"; properties: { sessionID: string; messageID: string; partID: string } }
  | { type: "permission.asked"; properties: PermissionRequest }
  | { type: "permission.replied"; properties: { sessionID: string; permissionID: string } }
  | { type: "todo.updated"; properties: { sessionID: string; todos: Todo[] } };
