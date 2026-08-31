import { afterEach, expect, mock, test } from "bun:test";

// ollama.ts imports `@/wigl/utils` (the host module path), which only
// resolves inside the app's own Vite build — not for a widget test run
// directly by `bun test`. Mocked here rather than routing this file
// through that build, same reasoning as tests/mock-storage.ts.
mock.module("@/wigl/utils", () => ({ runCmdBackground: async () => ({ stop: async () => {} }) }));
const { startOllama } = await import("../ollama");

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("startOllama resolves immediately, without spawning, when already reachable", async () => {
  globalThis.fetch = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

  const handle = await startOllama();
  // No-op stop: startOllama never spawned anything to own killing.
  await expect(handle.stop()).resolves.toBeUndefined();
});

test("startOllama rejects if ollama never becomes reachable within the timeout", async () => {
  globalThis.fetch = (async () => {
    throw new Error("connection refused");
  }) as unknown as typeof fetch;

  await expect(startOllama(50)).rejects.toThrow("ollama serve didn't become reachable in time");
});
