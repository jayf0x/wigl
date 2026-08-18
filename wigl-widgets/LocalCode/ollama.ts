// Reachability/metadata reads against Ollama's local API — no polling here.
// `useOpencodeServer.ts` owns when these get called (once at connect, and
// on the manual "reload" action — see its "Ollama reachability" section for
// why this went from an always-on poll back to on-demand).
const OLLAMA_BASE = "http://127.0.0.1:11434";

import { runCmdBackground } from "@/wigl/utils";

// Same PATH gap `serverProcess.ts` works around for `opencode`: a
// GUI-launched shell's PATH often doesn't include Homebrew's bin dirs.
const OLLAMA_CANDIDATES = ["/opt/homebrew/bin/ollama", "/usr/local/bin/ollama", "ollama"];

export interface OllamaHandle {
  /** No-op if this call found Ollama already running — we never own killing
   * a process we didn't spawn. */
  stop: () => Promise<void>;
}

/** Spawns `ollama serve` (trying each PATH candidate) and resolves once
 * `isOllamaReachable()` reports true, or rejects after `timeoutMs`. If
 * Ollama is already reachable, resolves immediately without spawning
 * anything. */
export const startOllama = async (timeoutMs = 8000): Promise<OllamaHandle> => {
  if (await isOllamaReachable()) return { stop: async () => {} };

  return new Promise((resolve, reject) => {
    let settled = false;
    let stopFn: (() => Promise<void>) | null = null;

    const poll = setInterval(async () => {
      if (settled) return;
      if (await isOllamaReachable()) {
        settled = true;
        clearInterval(poll);
        clearTimeout(timer);
        resolve({ stop: () => (stopFn ? stopFn() : Promise.resolve()) });
      }
    }, 400);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      stopFn?.().catch(() => {});
      reject(new Error("ollama serve didn't become reachable in time"));
    }, timeoutMs);

    const tryCandidate = async (index: number): Promise<void> => {
      if (settled || index >= OLLAMA_CANDIDATES.length) return;
      try {
        const { stop } = await runCmdBackground("sh", ["-c", `${OLLAMA_CANDIDATES[index]} serve 2>&1`], () => {});
        stopFn = stop;
      } catch {
        // this candidate isn't on disk / didn't spawn — try the next one
      }
      setTimeout(() => tryCandidate(index + 1), 1500);
    };
    tryCandidate(0);
  });
};

/** Names as Ollama itself reports them (e.g. `"smollm:135m"`) — these are
 * exactly the ids opencodeConfig.ts's `syncOllamaModels` needs, since a
 * custom `openai-compatible` provider addresses models by that same tag.
 * Empty on any failure — same as `isOllamaReachable() === false`, but this
 * doesn't distinguish "unreachable" from "reachable, zero models pulled";
 * use `isOllamaReachable` when that distinction actually matters (the
 * status indicator). */
export const listOllamaModels = async (): Promise<string[]> => {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
};

/** A dedicated reachability check (not just "did listOllamaModels find
 * anything") — for the "is Ollama actually running" status indicator,
 * where an empty model list and an unreachable server must read
 * differently to the user. */
export const isOllamaReachable = async (): Promise<boolean> => {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
};

export interface OllamaModelInfo {
  thinking: boolean;
  /** The model's real trained context window, straight from Ollama's own
   * GGUF metadata (`model_info["<architecture>.context_length"]` — verified
   * live: `2048` for `smollm:135m`, `262144` for `qwen3.5:0.8b`, keyed by
   * whatever `general.architecture` reports since the field name is
   * per-architecture). Null when Ollama doesn't report one for this model —
   * callers fall back to a flat guess in that case, not here. */
  contextLength: number | null;
}

// Process-lifetime cache: a model's capabilities/metadata don't change
// without a re-pull under the same tag, and `useOpencodeServer`'s
// hot-reload poll only notices a *new* model name appearing, not an
// existing one being re-pulled with different metadata — a rare enough
// edge case not to invalidate this cache over.
const modelInfoCache = new Map<string, OllamaModelInfo>();

/** Ground truth for both "does this model have a reasoning-effort control
 * at all" (opencode's own `/config/providers` has no such signal for a
 * custom `openai-compatible` provider unless `opencodeConfig.ts` puts a
 * `variants` block in config first) and "how much context can this model
 * actually take" (opencode has no dynamic-discovery of that either for a
 * custom provider) — one `/api/show` call per model covers both instead of
 * two round trips. */
export const getModelInfo = async (modelName: string): Promise<OllamaModelInfo> => {
  const cached = modelInfoCache.get(modelName);
  if (cached) return cached;
  const info = await fetch(`${OLLAMA_BASE}/api/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelName }),
  })
    .then((r) => (r.ok ? (r.json() as Promise<{ capabilities?: string[]; model_info?: Record<string, unknown> }>) : null))
    .catch(() => null);
  const modelInfo = info?.model_info ?? {};
  const architecture = modelInfo["general.architecture"];
  const rawContextLength = typeof architecture === "string" ? modelInfo[`${architecture}.context_length`] : undefined;
  const result: OllamaModelInfo = {
    thinking: info?.capabilities?.includes("thinking") ?? false,
    contextLength: typeof rawContextLength === "number" ? rawContextLength : null,
  };
  modelInfoCache.set(modelName, result);
  return result;
};
