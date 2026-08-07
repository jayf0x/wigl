// Test-only helpers for spinning up a real `opencode serve` against real
// Ollama models with deterministic decoding — see AGENTS.md's "Where the
// API shapes come from" for why this widget's regression coverage has to
// hit a live server rather than mock one. Not a widget module: `wigl test`
// only executes files matching bun:test's own test-file patterns, so this
// plain helper is imported by the *.test.ts files in this folder without
// being run as a suite itself.
import { realpathSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const PORT_RE = /listening on http:\/\/127\.0\.0\.1:(\d+)/;
const CONFIG_PATH = join(homedir(), ".config", "opencode", "opencode.jsonc");
const OLLAMA_TAGS_URL = "http://localhost:11434/api/tags";

// opencode's session store is one global SQLite DB shared by every `opencode
// serve` invocation on the machine, keyed by project *directory* — not
// per-server-instance or per-test-run (verified live: 30+ leftover test
// sessions from writing this suite all showed up in the real widget's
// sidebar, because it queried `/session` with no directory filter). Test
// sessions must live under a directory nobody would ever point the real
// widget at, and `client.ts`'s `listSessions(baseUrl, directory)` scopes the
// real widget to its own working directory — so as long as this constant
// and a real user's directory never collide, a leaked test session (this
// suite still cleans up after itself; this is defense in depth) can never
// show up next to real sessions.
//
// `realpathSync(tmpdir())`, not `tmpdir()` directly: on macOS `os.tmpdir()`
// returns a path through `/var`, itself a symlink to `/private/var` — verified
// live that opencode's server resolves the directory it's given (matching
// its own process cwd, see `startTestServer` below) to the real path, so a
// test asserting `created.directory === SCRATCH_DIRECTORY` failed on exactly
// that `/var` vs `/private/var` prefix, not a real drift bug. Resolving here
// once, against `tmpdir()` itself (which always exists, unlike the
// not-yet-created scratch subfolder), keeps this constant equal to whatever
// opencode actually reports.
export const SCRATCH_DIRECTORY = join(realpathSync(tmpdir()), "wigl-localcode-e2e-tests");

/** Creates `SCRATCH_DIRECTORY` on disk — opencode's session creation isn't
 * guaranteed to work against a directory that doesn't exist. */
export const ensureScratchDirectory = (): Promise<void> => mkdir(SCRATCH_DIRECTORY, { recursive: true }).then();

// Fixed seed + greedy decoding + a small output cap: the point isn't
// realistic chat behavior, it's a reply short and stable enough to assert
// on exactly, and a test run that finishes in seconds instead of minutes.
//
// 64 (the original value here) starved qwen3.5:0.8b on the generation e2e
// test's prompt: verified live that this exact model, at temperature 0,
// spends 100+ tokens on `thinking` before its first real-answer token for
// some prompts, so a too-small cap hits `done_reason: "length"` mid-thought
// and never emits `response` at all — the SSE stream then never produces a
// text part, and the test hangs until TURN_TIMEOUT_MS instead of failing
// fast. 256 gives real headroom above the ~160 tokens a short factual
// prompt against this model needed in that same live check.
export const SEED = 42;
export const MAX_TOKENS = 256;

interface ModelBlock {
  name: string;
  options?: Record<string, unknown>;
}

interface OpencodeConfigShape {
  provider?: Record<
    string,
    { npm?: string; name?: string; options?: { baseURL?: string }; models?: Record<string, ModelBlock> }
  >;
  [key: string]: unknown;
}

/** True if Ollama is reachable and `modelName` is actually pulled — the
 * e2e suite skips (not fails) when this is false, since a missing local
 * model is an environment gap, not a code regression. */
export const isOllamaModelAvailable = async (modelName: string): Promise<boolean> => {
  try {
    const res = await fetch(OLLAMA_TAGS_URL);
    if (!res.ok) return false;
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).some((m) => m.name === modelName);
  } catch {
    return false;
  }
};

/** Declares `modelNames` under opencode.jsonc's ollama provider with fixed
 * decoding options (temperature 0, seed 42, capped output) so real-model
 * replies are stable enough to assert on exactly — same file/shape
 * `opencodeConfig.ts`'s `syncOllamaModels` writes in the running app, just
 * with `options` set (production sync never sets per-model decoding
 * options — that would make every real chat greedy/seeded, not just tests).
 * Returns a restore function that puts the file back exactly as found (or
 * removes it if it didn't exist), so running this suite never permanently
 * changes the user's real Ollama chat behavior. */
export const withDeterministicModels = async (modelNames: string[]): Promise<() => Promise<void>> => {
  const original = await readFile(CONFIG_PATH, "utf8").catch(() => null);

  let config: OpencodeConfigShape;
  try {
    config = original ? (JSON.parse(original) as OpencodeConfigShape) : { $schema: "https://opencode.ai/config.json" };
  } catch {
    throw new Error(`${CONFIG_PATH} isn't plain JSON — can't safely test against it (see opencodeConfig.ts)`);
  }

  config.provider ??= {};
  const existing = config.provider.ollama;
  const models = { ...existing?.models };
  for (const name of modelNames) {
    models[name] = { name, options: { temperature: 0, seed: SEED, num_predict: MAX_TOKENS } };
  }
  config.provider.ollama = {
    npm: existing?.npm ?? "@ai-sdk/openai-compatible",
    name: existing?.name ?? "Ollama (local)",
    options: { baseURL: existing?.options?.baseURL ?? "http://localhost:11434/v1" },
    models,
  };

  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));

  return async () => {
    if (original === null) await unlink(CONFIG_PATH).catch(() => {});
    else await writeFile(CONFIG_PATH, original);
  };
};

/** Same wire format `client.ts`'s `subscribeEvents` consumes via
 * `EventSource` (`data: {...}\n\n` frames, no `event:` name — see
 * AGENTS.md) — reimplemented against a raw `fetch` stream here because
 * `EventSource` isn't a global under `bun test` (confirmed: `typeof
 * EventSource === "undefined"` even inside a running suite), unlike the
 * real Tauri webview this widget actually runs in. Returns an unsubscribe
 * function with the same shape as `subscribeEvents`. */
export const subscribeEventsViaFetch = (baseUrl: string, onEvent: (event: unknown) => void): (() => void) => {
  const controller = new AbortController();
  fetch(`${baseUrl}/event`, { signal: controller.signal })
    .then(async (res) => {
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line — same framing EventSource parses internally.
        let sep = buf.indexOf("\n\n");
        while (sep !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (line) {
            try {
              onEvent(JSON.parse(line.slice("data: ".length)));
            } catch (e) {
              console.error("[LocalCode tests] failed to parse SSE frame", e);
            }
          }
          sep = buf.indexOf("\n\n");
        }
      }
    })
    .catch(() => {
      // aborted on unsubscribe, or the server went away — nothing to do
    });
  return () => controller.abort();
};

/** Minimal `EventSource`-alike backed by the same fetch-stream parsing as
 * `subscribeEventsViaFetch`, installed as `globalThis.EventSource` so
 * `client.ts`'s real `subscribeEvents` (and anything built on it, e.g.
 * `housekeeper.ts`) can run unmodified under `bun test` — exercising the
 * actual production code path instead of a test-only reimplementation. */
export const installEventSourcePolyfill = (): void => {
  if (typeof globalThis.EventSource !== "undefined") return;
  class FetchEventSource {
    onmessage: ((ev: { data: string }) => void) | null = null;
    private unsubscribe: () => void;
    constructor(url: string) {
      this.unsubscribe = subscribeEventsViaFetch(url.replace(/\/event$/, ""), (event) => {
        this.onmessage?.({ data: JSON.stringify(event) });
      });
    }
    close() {
      this.unsubscribe();
    }
  }
  // biome-ignore lint/suspicious/noExplicitAny: polyfilling a DOM global bun test doesn't ship
  (globalThis as any).EventSource = FetchEventSource;
};

export interface TestServer {
  baseUrl: string;
  stop: () => void;
}

/** Spawns a real `opencode serve` on a random port, rooted at
 * `SCRATCH_DIRECTORY` — config must already be in place (see
 * `withDeterministicModels`, opencode.jsonc is read once at startup, not
 * hot-reloaded) and the directory must already exist (see
 * `ensureScratchDirectory`). `cwd` isn't cosmetic here: opencode ties every
 * session created through this process to *this process's own working
 * directory*, ignoring whatever `directory` a `POST /session` request body
 * asks for — see serverProcess.ts's `startOpencodeServer` doc comment for
 * the live trace that found this. Spawning without it would put every test
 * session wherever `bun test` itself happened to be run from (this repo's
 * root, in practice) — exactly the real-session pollution this file exists
 * to prevent. */
export const startTestServer = (timeoutMs = 15_000): Promise<TestServer> =>
  new Promise((resolve, reject) => {
    const proc = Bun.spawn(["opencode", "serve", "--port", "0", "--hostname", "127.0.0.1"], {
      cwd: SCRATCH_DIRECTORY,
      stdout: "pipe",
      stderr: "pipe",
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("opencode serve didn't report a listening port in time"));
    }, timeoutMs);

    (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const match = buf.match(PORT_RE);
          if (match) {
            clearTimeout(timer);
            resolve({ baseUrl: `http://127.0.0.1:${match[1]}`, stop: () => proc.kill() });
            return;
          }
        }
      } catch {
        // stream closed without ever matching — the timeout above handles it
      }
    })();
  });

export interface E2eSuite {
  ready: boolean;
  server: TestServer | null;
  teardown: () => Promise<void>;
}

/** Shared top-level-await setup for an e2e test file: checks the required
 * Ollama models are pulled, and if so, polyfills `EventSource`, points
 * `opencode.jsonc` at deterministic decoding for those models, and spawns a
 * real `opencode serve` rooted at `SCRATCH_DIRECTORY`. Split into
 * `opencode.session.e2e.test.ts` (CRUD/error-shape checks, no real
 * generation, seconds) and `opencode.generation.e2e.test.ts` (real model
 * output, up to ~90s/turn) specifically so a change that only touches
 * session/CRUD logic doesn't need to pay for a real generation to verify —
 * see the owner note in AGENTS.md's Testing section on suite cost. Must be
 * called from top-level `await` in the test file, not from `beforeAll` —
 * see either file for why. */
export const setupE2eSuite = async (requiredModels: string[]): Promise<E2eSuite> => {
  const available = await Promise.all(requiredModels.map(isOllamaModelAvailable));
  const ready = available.every(Boolean);

  if (!ready) {
    const missing = requiredModels.filter((_, i) => !available[i]);
    console.warn(`[LocalCode e2e] skipping — Ollama models missing (ollama pull ${missing.join(" && ollama pull ")})`);
    return { ready, server: null, teardown: async () => {} };
  }

  installEventSourcePolyfill();
  await ensureScratchDirectory();
  const restoreConfig = await withDeterministicModels(requiredModels);
  const server = await startTestServer();

  return {
    ready,
    server,
    teardown: async () => {
      server.stop();
      await restoreConfig();
    },
  };
};
