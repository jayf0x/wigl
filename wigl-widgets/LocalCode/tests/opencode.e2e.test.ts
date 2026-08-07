// Integration smoke test against a REAL `opencode serve` + real Ollama
// models — see TODO.md item 2 ("regression tests against opencode API
// drift") and AGENTS.md's "Where the API shapes come from": there's
// nothing to meaningfully mock here, the whole risk is "does the real API
// still look like client.ts/types.ts think it does". Deterministic via
// fixed seed + greedy decoding (temperature 0) + a small output cap, per
// owner instruction — every model call in this file should finish in a
// few seconds, not tie up CI-length minutes.
//
// Skips (not fails) if Ollama or the two required models aren't present —
// a missing local model is an environment gap on whatever machine runs
// this, not a code regression. Run `ollama pull qwen3.5:0.8b` and `ollama
// pull smollm:135m` to unskip locally.
import { afterAll, describe, expect, test } from "bun:test";
import * as client from "../client";
import { applyEvent, emptySessionState, type SessionState } from "../eventReducer";
import { generateSessionTitle, runHousekeeperPrompt } from "../housekeeper";
import {
  installEventSourcePolyfill,
  isOllamaModelAvailable,
  startTestServer,
  subscribeEventsViaFetch,
  withDeterministicModels,
  type TestServer,
} from "./testServer";
import type { OpencodeEvent } from "../types";

const REPLY_MODEL = { providerID: "ollama", modelID: "qwen3.5:0.8b" };
const HOUSEKEEPER_MODEL = { providerID: "ollama", modelID: "smollm:135m" };
const DIRECTORY = process.cwd();
// Content is deterministic (fixed seed + temperature 0 + capped output, see
// testServer.ts) but wall-clock isn't — a real local Ollama's per-token
// latency on this machine ranged from ~6s to ~50s for the same exact
// generation across otherwise-identical runs (GPU contention with whatever
// else is running), so this needs real headroom, not a tight bound.
const TURN_TIMEOUT_MS = 90_000;

// `test.skipIf`'s condition is evaluated at registration time, i.e. while
// this module's top level is still running — a `beforeAll` callback runs
// too late to gate it (it would always see the pre-`beforeAll` value and
// skip everything). Bun supports top-level `await`, so the real-server
// setup happens here instead, before any `describe`/`test` call.
let server: TestServer | null = null;
let restoreConfig: (() => Promise<void>) | null = null;

const [replyAvailable, housekeeperAvailable] = await Promise.all([
  isOllamaModelAvailable(REPLY_MODEL.modelID),
  isOllamaModelAvailable(HOUSEKEEPER_MODEL.modelID),
]);
const ready = replyAvailable && housekeeperAvailable;

if (!ready) {
  console.warn(
    `[LocalCode e2e] skipping — Ollama models missing (need ${REPLY_MODEL.modelID} and ${HOUSEKEEPER_MODEL.modelID}: ` +
      `ollama pull ${REPLY_MODEL.modelID} && ollama pull ${HOUSEKEEPER_MODEL.modelID})`,
  );
} else {
  installEventSourcePolyfill();
  restoreConfig = await withDeterministicModels([REPLY_MODEL.modelID, HOUSEKEEPER_MODEL.modelID]);
  server = await startTestServer();
}

afterAll(async () => {
  server?.stop();
  await restoreConfig?.();
});

/** Drives `sessionID`'s SSE stream through `eventReducer.applyEvent` until
 * `session.idle` fires (the turn is fully finished, not just started —
 * same signal `housekeeper.ts` waits on), or `timeoutMs` elapses. Returns
 * the final reduced state, so assertions read exactly what the widget's
 * own state would look like after the same events. */
const runTurnAndCollectState = (baseUrl: string, sessionID: string, send: () => Promise<void>): Promise<SessionState> =>
  new Promise((resolve, reject) => {
    let state = emptySessionState();
    const timer = setTimeout(() => {
      unsubscribe();
      // Ollama serializes generation per model (`-np 1`) — an abandoned
      // request would otherwise sit in that queue and slow down every test
      // (or real widget session) that runs after this one.
      client.abortSession(baseUrl, sessionID).catch(() => {});
      reject(new Error(`session ${sessionID} never went idle within ${TURN_TIMEOUT_MS}ms`));
    }, TURN_TIMEOUT_MS);
    const unsubscribe = subscribeEventsViaFetch(baseUrl, (raw) => {
      const event = raw as OpencodeEvent;
      state = applyEvent(state, event, sessionID);
      if (event.type === "session.idle" && event.properties.sessionID === sessionID) {
        clearTimeout(timer);
        unsubscribe();
        resolve(state);
      }
    });
    send().catch((e) => {
      clearTimeout(timer);
      unsubscribe();
      reject(e);
    });
  });

describe("opencode session CRUD (drift regression)", () => {
  test.skipIf(!ready)(
    "create, list, rename, delete round-trip with the shapes types.ts expects",
    async () => {
      const baseUrl = server?.baseUrl as string;
      const created = await client.createSession(baseUrl, { directory: DIRECTORY, title: "wigl e2e probe" });
      expect(created.id).toMatch(/^ses_/);
      expect(created.directory).toBe(DIRECTORY);
      expect(created.title).toBe("wigl e2e probe");
      expect(typeof created.time.created).toBe("number");

      const listed = await client.listSessions(baseUrl);
      expect(listed.some((s) => s.id === created.id)).toBe(true);

      const renamed = await client.renameSession(baseUrl, created.id, "renamed by e2e");
      expect(renamed.title).toBe("renamed by e2e");

      await client.deleteSession(baseUrl, created.id);
      const afterDelete = await client.listSessions(baseUrl);
      expect(afterDelete.some((s) => s.id === created.id)).toBe(false);
    },
  );
});

describe("prompt -> loading -> reply (the reported regression)", () => {
  test.skipIf(!ready)(
    "qwen3.5:0.8b (thinking model) produces a visible reasoning + text reply, deterministically",
    async () => {
      const baseUrl = server?.baseUrl as string;
      const session = await client.createSession(baseUrl, { directory: DIRECTORY });

      const state = await runTurnAndCollectState(baseUrl, session.id, () =>
        client.sendPrompt(baseUrl, session.id, {
          text: "Say hello in exactly 3 words.",
          model: REPLY_MODEL,
          agent: "build",
        }),
      );

      expect(state.error).toBeNull();
      const assistant = state.messages.find((m) => m.info.role === "assistant");
      expect(assistant).toBeDefined();

      const reasoning = assistant?.parts.find((p) => p.type === "reasoning");
      expect(reasoning?.text?.trim().length ?? 0).toBeGreaterThan(0);

      const text = assistant?.parts.find((p) => p.type === "text");
      // Locked from a real run against this exact model/seed/options — see
      // testServer.ts's withDeterministicModels. A changed reply here means
      // either the model or opencode's decoding params silently drifted.
      expect(text?.text?.trim()).toBe("Hello");
    },
    TURN_TIMEOUT_MS + 5000,
  );

  test.skipIf(!ready)(
    "an unknown model surfaces a visible session error instead of a silently missing reply",
    async () => {
      // Regression test for the exact bug this session fixed: before
      // eventReducer.ts existed, session.error fell through
      // useActiveSession's switch's `default` case — a failed turn left no
      // assistant message AND no error, i.e. the reported "prompt -> loading
      // -> [nothing]" symptom. See AGENTS.md/TODO.md for the live trace.
      const baseUrl = server?.baseUrl as string;
      const session = await client.createSession(baseUrl, { directory: DIRECTORY });

      const state = await runTurnAndCollectState(baseUrl, session.id, () =>
        client.sendPrompt(baseUrl, session.id, {
          text: "hi",
          model: { providerID: "ollama", modelID: "nonexistent-model-xyz" },
          agent: "build",
        }),
      );

      expect(state.messages.some((m) => m.info.role === "assistant")).toBe(false);
      expect(state.error).toMatch(/model not found/i);
      expect(state.busy).toBe(false);
    },
    TURN_TIMEOUT_MS + 5000,
  );
});

// Not asserted as its own test: whether the "build" agent's tool schema
// gets attached to a given completion request raced, in practice, against
// opencode's own plugin/provider registration (visible as a burst of
// `plugin.added` events right after the first prompt on a freshly started
// server — see the SSE trace in AGENTS.md). Sending `smollm:135m` a prompt
// under the default "build" agent reproduced Ollama's real "does not
// support tools" 400 (verified live, see housekeeper.ts's doc comment) but
// not on every run, so it isn't reliable enough to assert on here — the
// "unknown model" case above already exercises the same session.error
// surfacing path deterministically.

describe("housekeeper model (session titling)", () => {
  test.skipIf(!ready)(
    "runHousekeeperPrompt returns deterministic text from a real throwaway session",
    async () => {
      const baseUrl = server?.baseUrl as string;
      // "title" — a toolless native agent, see runHousekeeperPrompt's doc
      // comment. Omitting `agent` here (defaulting to the "build" session
      // agent, which always attaches opencode's tool schema) is exactly
      // the "does not support tools" 400 this suite caught against
      // smollm:135m — a real Ollama-model limitation, not a widget bug,
      // but one every housekeeper caller must route around explicitly.
      const reply = await runHousekeeperPrompt(
        baseUrl,
        HOUSEKEEPER_MODEL,
        "Reply with only the word: pong",
        DIRECTORY,
        "title",
      );
      expect(reply).toBeTruthy();
      expect(reply?.length).toBeGreaterThan(0);

      // The scratch session must not leak into the real session list.
      const sessions = await client.listSessions(baseUrl);
      expect(sessions.some((s) => s.title.includes("pong"))).toBe(false);
    },
    TURN_TIMEOUT_MS + 5000,
  );

  test.skipIf(!ready)(
    "generateSessionTitle produces a short, punctuation-stripped title",
    async () => {
      const baseUrl = server?.baseUrl as string;
      const title = await generateSessionTitle(
        baseUrl,
        HOUSEKEEPER_MODEL,
        "Fix the login button not responding to clicks on Safari",
        DIRECTORY,
      );
      expect(title).toBeTruthy();
      expect(title?.length).toBeLessThanOrEqual(61); // AUTO_TITLE_LENGTH-ish ceiling, see generateSessionTitle
      expect(title).not.toMatch(/["'*_`]/);
    },
    TURN_TIMEOUT_MS + 5000,
  );
});
