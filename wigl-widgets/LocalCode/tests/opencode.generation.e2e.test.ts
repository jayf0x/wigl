// Slow half of the live-server e2e coverage: tests that need a REAL Ollama
// generation to complete — qwen3.5:0.8b (a real thinking model, so we can
// assert on reasoning content) and smollm:135m (the housekeeper default).
// Deterministic via fixed seed + greedy decoding + a capped output (see
// testServer.ts's withDeterministicModels) per owner instruction, but
// wall-clock still isn't free: per-token latency on the dev machine this
// was written on ranged ~6s-50s for the *same* generation across runs
// (Ollama serializes per model, `-np 1`, so GPU contention matters) — this
// file alone can take over a minute. Don't rerun it after every small
// edit; `opencode.session.e2e.test.ts` covers everything that doesn't need
// real model output, and `eventReducer.test.ts` covers the pure logic with
// zero server/model cost at all — reach for those first while iterating.
//
// Skips (not fails) if qwen3.5:0.8b / smollm:135m aren't pulled locally.
import { afterAll, describe, expect, test } from "bun:test";
import * as client from "../client";
import { applyEvent, emptySessionState, type SessionState } from "../eventReducer";
import { generateSessionTitle, runHousekeeperPrompt } from "../housekeeper";
import { SCRATCH_DIRECTORY, setupE2eSuite, subscribeEventsViaFetch } from "./testServer";
import type { OpencodeEvent } from "../types";

const REPLY_MODEL = { providerID: "ollama", modelID: "qwen3.5:0.8b" };
const HOUSEKEEPER_MODEL = { providerID: "ollama", modelID: "smollm:135m" };
const DIRECTORY = SCRATCH_DIRECTORY;
// Content is deterministic (fixed seed + temperature 0 + capped output) but
// wall-clock isn't — see the file banner above. Needs real headroom.
const TURN_TIMEOUT_MS = 90_000;

// See opencode.session.e2e.test.ts for why this is top-level `await`, not
// `beforeAll` — `test.skipIf` evaluates its condition before `beforeAll`
// would ever run.
const { ready, server, teardown } = await setupE2eSuite([REPLY_MODEL.modelID, HOUSEKEEPER_MODEL.modelID]);

const createdSessionIds: string[] = [];
const createTrackedSession = async (
  baseUrl: string,
  opts: { directory?: string; title?: string },
): Promise<Awaited<ReturnType<typeof client.createSession>>> => {
  const session = await client.createSession(baseUrl, opts);
  createdSessionIds.push(session.id);
  return session;
};

afterAll(async () => {
  if (server) {
    await Promise.all(createdSessionIds.map((id) => client.deleteSession(server.baseUrl, id).catch(() => {})));
  }
  await teardown();
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

describe("prompt -> loading -> reply (the reported regression)", () => {
  test.skipIf(!ready)(
    "qwen3.5:0.8b (thinking model) produces a visible reasoning + text reply, deterministically",
    async () => {
      const baseUrl = server?.baseUrl as string;
      const session = await createTrackedSession(baseUrl, { directory: DIRECTORY });

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
      // Locked from real runs against this exact model/seed/options — see
      // testServer.ts's withDeterministicModels. Case wobbled between
      // "Hello"/"hello" across runs under otherwise identical settings once
      // the session's directory context changed (SCRATCH_DIRECTORY has no
      // project files opencode can pick up, unlike the real repo) — still
      // deterministic per-directory, just case-insensitive here since that's
      // the part that isn't load-bearing for "did a reply actually render".
      expect(text?.text?.trim().toLowerCase()).toBe("hello");
    },
    TURN_TIMEOUT_MS + 5000,
  );

  test.skipIf(!ready)(
    "editing a question mid-reply throws a real error (opencode 409), not a silent hang",
    async () => {
      // Regression test for a second "no visible feedback" bug found while
      // fixing the first one: opencode rejects `/session/{id}/revert` with
      // a 409 SessionBusyError while a turn is still generating (verified
      // live). MessageList.tsx now disables the edit trigger while
      // `session.busy`, and useActiveSession.ts's `editAndResend` catches
      // this into `session.error` as defense in depth — this test exercises
      // the raw API behavior editAndResend catches, not the UI gating
      // (which needs a DOM, not available under `bun test`).
      const baseUrl = server?.baseUrl as string;
      const session = await createTrackedSession(baseUrl, { directory: DIRECTORY });
      await client.sendPrompt(baseUrl, session.id, {
        text: "Say hello in exactly 3 words.",
        model: REPLY_MODEL,
        agent: "build",
      });

      // Don't wait for idle — the whole point is to catch it still busy.
      await new Promise((r) => setTimeout(r, 500));
      const messages = await client.listMessages(baseUrl, session.id);
      const userMessageId = messages.find((m) => m.info.role === "user")?.info.id;
      expect(userMessageId).toBeTruthy();

      await expect(client.revertToMessage(baseUrl, session.id, userMessageId as string)).rejects.toThrow(/busy/i);

      await client.abortSession(baseUrl, session.id).catch(() => {});
    },
    20_000,
  );
});

// Not asserted as its own test: whether the "build" agent's tool schema
// gets attached to a given completion request raced, in practice, against
// opencode's own plugin/provider registration (visible as a burst of
// `plugin.added` events right after the first prompt on a freshly started
// server — see the SSE trace in AGENTS.md). Sending `smollm:135m` a prompt
// under the default "build" agent reproduced Ollama's real "does not
// support tools" 400 (verified live, see housekeeper.ts's doc comment) but
// not on every run, so it isn't reliable enough to assert on here —
// opencode.session.e2e.test.ts's "unknown model" case already exercises
// the same session.error surfacing path deterministically.

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
      const sessions = await client.listSessions(baseUrl, DIRECTORY);
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
