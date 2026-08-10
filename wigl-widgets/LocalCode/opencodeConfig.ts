// Keeps opencode's own config (`~/.config/opencode/opencode.jsonc`) in sync
// with whatever models are actually pulled in Ollama — this is what makes
// the model picker "reliant on Ollama" instead of a list someone typed once
// (see AGENTS.md's "model catalog" section for why this file needs to
// exist at all: opencode has no dynamic Ollama discovery of its own,
// verified live — a custom `openai-compatible` provider must list every
// model explicitly in config, confirmed by testing `opencode models ollama`
// with and without a `models` block).
import { homeDir, runCmd } from "@/wigl/utils";

const CONFIG_REL_PATH = ".config/opencode/opencode.jsonc";
const OLLAMA_PROVIDER_ID = "ollama";
const OLLAMA_BASE_URL = "http://localhost:11434/v1";

const configPath = async () => `${await homeDir()}/${CONFIG_REL_PATH}`;

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

const readRaw = async (path: string): Promise<string> => {
  const out = await runCmd("sh", ["-c", `cat ${shQuote(path)} 2>/dev/null`]);
  return out.stdout.trim();
};

// Writes via base64 so JSON's quotes/backslashes never have to survive a
// shell string — same trick as any binary-safe shell round trip.
const writeRaw = async (path: string, content: string): Promise<void> => {
  const dir = path.slice(0, path.lastIndexOf("/"));
  const b64 = btoa(content);
  const out = await runCmd("sh", ["-c", `mkdir -p ${shQuote(dir)} && echo ${shQuote(b64)} | base64 -d > ${shQuote(path)}`]);
  if (out.code !== 0) throw new Error(out.stderr || "failed to write opencode config");
};

interface OpencodeModelConfig {
  name?: string;
  variants?: Record<string, { reasoningEffort: string }>;
}

interface OpencodeConfigShape {
  provider?: Record<
    string,
    {
      npm?: string;
      name?: string;
      options?: { baseURL?: string };
      models?: Record<string, OpencodeModelConfig>;
    }
  >;
  tools?: Record<string, boolean>;
  [key: string]: unknown;
}

/** Shared read+parse for every config-mutating step below — same fail-safe
 * rule everywhere: a config file that isn't plain JSON (e.g. a user added
 * real `//` comments — this repo doesn't bundle a JSONC-comment-aware
 * parser, see AGENTS.md) is left untouched rather than risking a
 * corrupting rewrite, and every caller must handle a `null` result the same
 * way (skip the sync, log why). */
const readConfig = async (path: string): Promise<OpencodeConfigShape | null> => {
  const raw = await readRaw(path);
  try {
    return raw ? (JSON.parse(raw) as OpencodeConfigShape) : { $schema: "https://opencode.ai/config.json" };
  } catch (e) {
    console.error("[LocalCode] opencode.jsonc isn't plain JSON — skipping config sync", e);
    return null;
  }
};

export interface OllamaModelSync {
  name: string;
  /** From `ollama.ts`'s `modelSupportsThinking` — decides whether this
   * model's config entry gets a `variants` block at all (see below). */
  thinking: boolean;
}

// The three effort levels this widget's UI offers (see Composer.tsx) —
// `reasoningEffort` is the field opencode's `variants` block forwards
// straight through as the OpenAI-compatible request's `reasoning_effort`
// field, verified live via a logging proxy in front of Ollama: `"high"`/
// `"low"` reach Ollama unchanged, and `"none"` is the one value that
// actually suppresses Ollama's `reasoning` output entirely (no `<think>`
// step at all, not just a shorter one) — confirmed by diffing the SSE
// response with and without it for the same prompt against a thinking
// model. `off` has to be a real variant like the others, not the absence of
// one: `variant: undefined` (no override) just leaves Ollama on its default
// thinking behavior, which is the bug this fixes (backlog.md B1).
const REASONING_VARIANTS: Record<string, { reasoningEffort: string }> = {
  high: { reasoningEffort: "high" },
  low: { reasoningEffort: "low" },
  off: { reasoningEffort: "none" },
};

/** Adds any of `models` that aren't already declared under the ollama
 * provider block, creating that block if it doesn't exist yet, and gives a
 * thinking-capable model's entry a `variants` block if it doesn't have one
 * yet, or patches in a missing `off` key if it already has one from before
 * `off` was a real variant (covers a brand-new model, one synced by an
 * older version of this function before `variants` existed, and one synced
 * before `off` was added to `REASONING_VARIANTS`). Never removes a model or a
 * variant once written — one pulled via `ollama rm` just stops being
 * offered from Ollama's own list, and quietly stays declared in opencode's
 * config (harmless: opencode just can't reach it, same as any
 * misconfigured model). Returns whether the file was actually written, so
 * the caller knows whether an `opencode serve` restart is needed to pick it
 * up (config is NOT hot-reloaded — verified live: editing the file while a
 * server was already running had no effect until restart). Fails safe: a
 * config file that isn't valid JSON (e.g. a user added real `//` comments —
 * this repo doesn't bundle a JSONC-comment-aware parser, see AGENTS.md) is
 * left untouched rather than risking a corrupting rewrite. */
export const syncOllamaModels = async (models: OllamaModelSync[]): Promise<boolean> => {
  if (models.length === 0) return false;
  const path = await configPath();
  const config = await readConfig(path);
  if (!config) return false;

  config.provider ??= {};
  const existing = config.provider[OLLAMA_PROVIDER_ID];
  const configuredModels = { ...existing?.models };
  let changed = !existing;
  for (const { name, thinking } of models) {
    const entry = configuredModels[name];
    if (!entry) {
      configuredModels[name] = thinking ? { name, variants: REASONING_VARIANTS } : { name };
      changed = true;
    } else if (thinking && !entry.variants) {
      configuredModels[name] = { ...entry, variants: REASONING_VARIANTS };
      changed = true;
    } else if (thinking && entry.variants && !entry.variants.off) {
      configuredModels[name] = { ...entry, variants: { ...entry.variants, off: REASONING_VARIANTS.off } };
      changed = true;
    }
  }
  if (!changed) return false;

  config.provider[OLLAMA_PROVIDER_ID] = {
    npm: existing?.npm ?? "@ai-sdk/openai-compatible",
    name: existing?.name ?? "Ollama (local)",
    options: { baseURL: existing?.options?.baseURL ?? OLLAMA_BASE_URL },
    models: configuredModels,
  };

  await writeRaw(path, JSON.stringify(config, null, 2));
  return true;
};

/** Sets the global `tools.skill: false` in opencode's config — verified
 * live (`opencode agent list`'s permission dump lists an `external_directory`
 * allow-rule for `~/.claude/skills/<name>/*` with zero wigl-side config)
 * that opencode discovers and offers Claude Code's own `~/.claude/skills/`
 * `SKILL.md` files to every agent by default, this widget included. Small
 * local models handle those skills badly (see AGENTS.md's "Skills" note) —
 * until that's revisited, disabling the tool globally is simpler and safer
 * than trying to strip it per-agent, since this widget doesn't own opencode's
 * agent definitions (`build`, `plan`, or any custom agent a user has
 * installed via `opencode plugin`) and has no business rewriting them.
 * Idempotent — a no-op (and no file write) once already set. Same
 * not-hot-reloaded / fails-safe-on-non-JSON rules as `syncOllamaModels`. */
export const disableSkillTool = async (): Promise<boolean> => {
  const path = await configPath();
  const config = await readConfig(path);
  if (!config) return false;
  if (config.tools?.skill === false) return false;

  config.tools = { ...config.tools, skill: false };
  await writeRaw(path, JSON.stringify(config, null, 2));
  return true;
};
