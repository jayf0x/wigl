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
  time?: { start?: number; end?: number };
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
  error?: { message: string };
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
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "medium" | "low";
}

export interface AgentDef {
  name: string;
  description?: string;
  mode: "primary" | "subagent" | "all";
  model?: { providerID: string; modelID: string };
}

export interface ModelVariant {
  reasoningEffort: string;
}

export interface ProviderModel {
  id: string;
  providerID: string;
  name: string;
  capabilities: { reasoning: boolean; toolcall: boolean };
  variants?: Record<string, ModelVariant>;
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
