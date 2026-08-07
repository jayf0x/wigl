// Fast half of the live-server e2e coverage: session CRUD, directory
// scoping, and error-shape checks that don't need a real model generation
// — see AGENTS.md's "Where the API shapes come from" for why this needs a
// live `opencode serve` at all rather than a mock. The real-generation
// tests (slow: real Ollama output, up to ~90s/turn) live in
// `opencode.generation.e2e.test.ts` — kept separate so a change that only
// touches session/CRUD logic doesn't pay for a real generation to verify.
//
// Skips (not fails) if the required Ollama models aren't pulled — this
// file still needs them (deterministic-decoding config, directory scoping)
// even though its own assertions don't wait on real output.
import { afterAll, describe, expect, test } from "bun:test";
import * as client from "../client";
import { applyEvent, emptySessionState, type SessionState } from "../eventReducer";
import { SCRATCH_DIRECTORY, setupE2eSuite, subscribeEventsViaFetch } from "./testServer";
import type { OpencodeEvent } from "../types";

const REPLY_MODEL_ID = "qwen3.5:0.8b";
const HOUSEKEEPER_MODEL_ID = "smollm:135m";
// Never the real repo/home directory a human would actually point the
// widget at — see testServer.ts's SCRATCH_DIRECTORY doc comment for why
// that matters (opencode's session store is global, not per-test-run).
const DIRECTORY = SCRATCH_DIRECTORY;

// `test.skipIf`'s condition is evaluated at registration time, i.e. while
// this module's top level is still running — a `beforeAll` callback runs
// too late to gate it (it would always see the pre-`beforeAll` value and
// skip everything). Bun supports top-level `await`, so setup happens here.
const { ready, server, teardown } = await setupE2eSuite([REPLY_MODEL_ID, HOUSEKEEPER_MODEL_ID]);

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

describe("opencode session CRUD (drift regression)", () => {
  test.skipIf(!ready)(
    "create, list, rename, delete round-trip with the shapes types.ts expects",
    async () => {
      const baseUrl = server?.baseUrl as string;
      const created = await createTrackedSession(baseUrl, { directory: DIRECTORY, title: "wigl e2e probe" });
      expect(created.id).toMatch(/^ses_/);
      expect(created.directory).toBe(DIRECTORY);
      expect(created.title).toBe("wigl e2e probe");
      expect(typeof created.time.created).toBe("number");

      const listed = await client.listSessions(baseUrl, DIRECTORY);
      expect(listed.some((s) => s.id === created.id)).toBe(true);
      // The directory filter itself: a session under some other directory
      // (opencode's global store has plenty from real machine usage) must
      // never leak into a `directory`-scoped list.
      expect(listed.every((s) => s.directory === DIRECTORY)).toBe(true);

      const renamed = await client.renameSession(baseUrl, created.id, "renamed by e2e");
      expect(renamed.title).toBe("renamed by e2e");

      await client.deleteSession(baseUrl, created.id);
      const afterDelete = await client.listSessions(baseUrl, DIRECTORY);
      expect(afterDelete.some((s) => s.id === created.id)).toBe(false);
    },
  );
});

describe("session.error surfacing (no real generation needed)", () => {
  test.skipIf(!ready)(
    "an unknown model surfaces a visible session error instead of a silently missing reply",
    async () => {
      // Regression test for the exact bug this session fixed: before
      // eventReducer.ts existed, session.error fell through
      // useActiveSession's switch's `default` case — a failed turn left no
      // assistant message AND no error, i.e. the reported "prompt -> loading
      // -> [nothing]" symptom. See AGENTS.md/TODO.md for the live trace.
      // Fails fast (opencode rejects the unknown model before it ever
      // touches Ollama), so this belongs in the fast file despite living
      // next to real-generation concerns conceptually.
      const baseUrl = server?.baseUrl as string;
      const session = await createTrackedSession(baseUrl, { directory: DIRECTORY });

      const state = await new Promise<SessionState>((resolve, reject) => {
        let state = emptySessionState();
        const timer = setTimeout(() => {
          unsubscribe();
          reject(new Error(`session ${session.id} never went idle`));
        }, 15_000);
        const unsubscribe = subscribeEventsViaFetch(baseUrl, (raw) => {
          const event = raw as OpencodeEvent;
          state = applyEvent(state, event, session.id);
          if (event.type === "session.idle" && event.properties.sessionID === session.id) {
            clearTimeout(timer);
            unsubscribe();
            resolve(state);
          }
        });
        client
          .sendPrompt(baseUrl, session.id, {
            text: "hi",
            model: { providerID: "ollama", modelID: "nonexistent-model-xyz" },
            agent: "build",
          })
          .catch((e) => {
            clearTimeout(timer);
            unsubscribe();
            reject(e);
          });
      });

      expect(state.messages.some((m) => m.info.role === "assistant")).toBe(false);
      expect(state.error).toMatch(/model not found/i);
      expect(state.busy).toBe(false);
    },
    20_000,
  );
});
