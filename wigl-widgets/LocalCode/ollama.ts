// Reachability/metadata reads against Ollama's local API — no polling here
// (see TODO.md's "status polling removed" entry for why the old always-on
// status UI and its poll loop are gone; a real error surface is future
// work, not this file's job).
const OLLAMA_BASE = "http://127.0.0.1:11434";

/** Names as Ollama itself reports them (e.g. `"smollm:135m"`) — these are
 * exactly the ids opencodeConfig.ts's `syncOllamaModels` needs, since a
 * custom `openai-compatible` provider addresses models by that same tag. */
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

// Process-lifetime cache: a model's capabilities don't change without a
// re-pull under the same tag, and `useOpencodeServer`'s hot-reload poll only
// notices a *new* model name appearing, not an existing one being re-pulled
// with different capabilities — a rare enough edge case not to invalidate
// this cache over.
const thinkingCache = new Map<string, boolean>();

/** Whether Ollama reports `"thinking"` in `POST /api/show`'s `capabilities`
 * array for this model — verified live (`ollama show <model>` / the same
 * endpoint): present for a real reasoning model (e.g. `qwen3.5:0.8b`),
 * absent for a plain one (e.g. `smollm:135m`). This is the ground truth for
 * "does this model have a reasoning-effort control at all" — opencode's own
 * `/config/providers` has no such signal for a custom `openai-compatible`
 * provider unless `opencodeConfig.ts` puts a `variants` block in config
 * first, which is what this is for. */
export const modelSupportsThinking = async (modelName: string): Promise<boolean> => {
  const cached = thinkingCache.get(modelName);
  if (cached !== undefined) return cached;
  const supports = await fetch(`${OLLAMA_BASE}/api/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelName }),
  })
    .then((r) => (r.ok ? (r.json() as Promise<{ capabilities?: string[] }>) : null))
    .then((d) => d?.capabilities?.includes("thinking") ?? false)
    .catch(() => false);
  thinkingCache.set(modelName, supports);
  return supports;
};
