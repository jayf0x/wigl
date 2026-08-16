// Pure unit tests for eventReducer.ts — the logic deciding whether an
// assistant reply actually shows up in the transcript. Event payloads below
// are trimmed copies of real frames captured from a live `opencode serve`
// v1.18.15 SSE stream (see AGENTS.md — "Where the API shapes come from"),
// not hand-guessed shapes, so a real API drift on a field these events
// touch would show up here as a shape mismatch, not just in the e2e suite.
import { describe, expect, test } from "bun:test";
import { applyEvent, emptySessionState } from "../eventReducer";
import type { OpencodeEvent } from "../types";

const SID = "ses_test0000000000000000001";
const USER_MSG = "msg_user0000000000000000001";
const ASSISTANT_MSG = "msg_assistant000000000000001";

const userTurn: OpencodeEvent[] = [
  {
    type: "message.updated",
    properties: { info: { id: USER_MSG, sessionID: SID, role: "user", time: { created: 1 } } },
  },
  {
    type: "message.part.updated",
    properties: {
      part: { id: "prt_user_text", sessionID: SID, messageID: USER_MSG, type: "text", text: "hi" },
    },
  },
];

const assistantStart: OpencodeEvent = {
  type: "message.updated",
  properties: {
    info: { id: ASSISTANT_MSG, sessionID: SID, role: "assistant", time: { created: 2 } },
  },
};

const reasoningStart: OpencodeEvent = {
  type: "message.part.updated",
  properties: {
    part: { id: "prt_reason", sessionID: SID, messageID: ASSISTANT_MSG, type: "reasoning", text: "" },
  },
};

const reasoningDone: OpencodeEvent = {
  type: "message.part.updated",
  properties: {
    part: {
      id: "prt_reason",
      sessionID: SID,
      messageID: ASSISTANT_MSG,
      type: "reasoning",
      text: "thinking about it...",
      time: { start: 2, end: 3 },
    },
  },
};

const textStart: OpencodeEvent = {
  type: "message.part.updated",
  properties: {
    part: { id: "prt_text", sessionID: SID, messageID: ASSISTANT_MSG, type: "text", text: "" },
  },
};

const textDone: OpencodeEvent = {
  type: "message.part.updated",
  properties: {
    part: {
      id: "prt_text",
      sessionID: SID,
      messageID: ASSISTANT_MSG,
      type: "text",
      text: "Hello there!",
      time: { start: 3, end: 4 },
    },
  },
};

const idle: OpencodeEvent = { type: "session.idle", properties: { sessionID: SID } };

const applyAll = (events: OpencodeEvent[]) => events.reduce((s, e) => applyEvent(s, e, SID), emptySessionState());

describe("applyEvent — happy path", () => {
  test("a full turn (reasoning then text) ends with a visible assistant reply", () => {
    const state = applyAll([
      ...userTurn,
      assistantStart,
      reasoningStart,
      reasoningDone,
      textStart,
      textDone,
      idle,
    ]);

    expect(state.busy).toBe(false);
    expect(state.error).toBeNull();
    expect(state.messages).toHaveLength(2);

    const assistant = state.messages.find((m) => m.info.role === "assistant");
    expect(assistant).toBeDefined();
    const textPart = assistant?.parts.find((p) => p.type === "text");
    expect(textPart?.text).toBe("Hello there!");
    const reasoningPart = assistant?.parts.find((p) => p.type === "reasoning");
    expect(reasoningPart?.text).toBe("thinking about it...");
  });

  test("a part update for a message that hasn't arrived yet is dropped, not crashed on", () => {
    // message.part.updated arriving before its message.updated is a real
    // possible ordering (SSE frames can interleave) — the reducer must not
    // throw or fabricate a message from a bare part.
    const state = applyEvent(emptySessionState(), textDone, SID);
    expect(state.messages).toHaveLength(0);
  });

  test("events for a different session are ignored", () => {
    const state = applyEvent(emptySessionState(), assistantStart, "ses_other");
    expect(state.messages).toHaveLength(0);
  });
});

describe("applyEvent — session.error (the 'no reply ever shown' bug)", () => {
  test("an errored turn surfaces a visible error instead of silently vanishing", () => {
    // Real trace from a live server given an unknown model: message.updated
    // fires for the user's own message, then session.error — no assistant
    // message.updated ever arrives, so an unhandled session.error means no
    // error, no assistant bubble, spinner (if any) stuck — see AGENTS.md's
    // "Decisions log" for the live trace that found this.
    const state = applyAll([
      ...userTurn,
      {
        type: "session.error",
        properties: {
          sessionID: SID,
          error: { name: "UnknownError", data: { message: "Model not found: ollama/nonexistent-model." } },
        },
      },
      idle,
    ]);

    expect(state.error).toBe("Model not found: ollama/nonexistent-model.");
    expect(state.busy).toBe(false);
    expect(state.messages.some((m) => m.info.role === "assistant")).toBe(false);
  });

  test("busy flips true on send and false again on session.idle even with no error", () => {
    let state = { ...emptySessionState(), busy: true };
    state = applyEvent(state, idle, SID);
    expect(state.busy).toBe(false);
  });

  test("session.error with no sessionID (global) still surfaces for the active session", () => {
    const state = applyEvent({ ...emptySessionState(), busy: true }, {
      type: "session.error",
      properties: { error: { data: { message: "opencode crashed" } } },
    }, SID);
    expect(state.error).toBe("opencode crashed");
    expect(state.busy).toBe(false);
  });
});

describe("applyEvent — permissions and todos", () => {
  test("permission.asked then permission.replied round-trips to empty", () => {
    let state = applyEvent(emptySessionState(), {
      type: "permission.asked",
      properties: { id: "perm_1", sessionID: SID, permission: "bash", patterns: ["*"], metadata: {} },
    }, SID);
    expect(state.permissions).toHaveLength(1);

    state = applyEvent(state, { type: "permission.replied", properties: { sessionID: SID, permissionID: "perm_1" } }, SID);
    expect(state.permissions).toHaveLength(0);
  });

  test("todo.updated replaces the todo list wholesale", () => {
    const state = applyEvent(emptySessionState(), {
      type: "todo.updated",
      properties: {
        sessionID: SID,
        todos: [{ id: "t1", content: "write tests", status: "in_progress", priority: "high" }],
      },
    }, SID);
    expect(state.todos).toHaveLength(1);
    expect(state.todos[0].content).toBe("write tests");
  });
});

describe("applyEvent — unknown event types", () => {
  test("an event type this widget doesn't know about is a no-op, not a throw", () => {
    // opencode ships events this widget has never modeled (session.status,
    // plugin.added, ...) — see client.ts's subscribeEvents comment. Casting
    // past the union mirrors what a real drifted/unrecognized frame from
    // JSON.parse would look like at runtime.
    const before = emptySessionState();
    const weird = { type: "session.status", properties: {} } as unknown as OpencodeEvent;
    expect(() => applyEvent(before, weird, SID)).not.toThrow();
    expect(applyEvent(before, weird, SID)).toEqual(before);
  });
});

describe("applyEvent — message.part.delta (incremental token streaming)", () => {
  test("deltas accumulate onto the part's text as they arrive", () => {
    // Real shape captured from a live `opencode serve` + Ollama session
    // (scripts/dev/ollama-stream-check.py): providers that don't send
    // frequent message.part.updated snapshots still send these per-token.
    const state = applyAll([
      ...userTurn,
      assistantStart,
      textStart,
      { type: "message.part.delta", properties: { sessionID: SID, messageID: ASSISTANT_MSG, partID: "prt_text", field: "text", delta: "Hel" } },
      { type: "message.part.delta", properties: { sessionID: SID, messageID: ASSISTANT_MSG, partID: "prt_text", field: "text", delta: "lo!" } },
    ]);
    const assistant = state.messages.find((m) => m.info.role === "assistant");
    const textPart = assistant?.parts.find((p) => p.type === "text");
    expect(textPart?.text).toBe("Hello!");
  });

  test("a delta for a part that hasn't arrived yet is dropped, not crashed on", () => {
    const state = applyEvent(emptySessionState(), {
      type: "message.part.delta",
      properties: { sessionID: SID, messageID: ASSISTANT_MSG, partID: "prt_text", field: "text", delta: "x" },
    }, SID);
    expect(state.messages).toHaveLength(0);
  });

  test("a delta for a different session is ignored", () => {
    const state = applyAll([...userTurn, assistantStart, textStart]);
    const next = applyEvent(state, {
      type: "message.part.delta",
      properties: { sessionID: "ses_other", messageID: ASSISTANT_MSG, partID: "prt_text", field: "text", delta: "x" },
    }, SID);
    expect(next).toEqual(state);
  });
});
