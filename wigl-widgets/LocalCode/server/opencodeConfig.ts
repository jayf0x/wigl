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
// shell string — same trick as any binary-safe shell round trip. Plain
// `btoa(content)` throws `InvalidCharacterError` the moment `content` has
// any character outside Latin1 (verified live: an em dash in a `prompt`
// string — see `syncChatAgent` — was enough) — caught by every caller's
// `.catch(console.error)`, so the failure was silent: no write, no crash,
// nothing to notice short of diffing the file by hand. Encoding through
// `TextEncoder` first keeps this correct for real UTF-8 content (model
// names, directory paths, and any prose a `prompt`/`description` field
// holds) instead of quietly limiting every writer here to ASCII.
const writeRaw = async (path: string, content: string): Promise<void> => {
  const dir = path.slice(0, path.lastIndexOf("/"));
  const bytes = new TextEncoder().encode(content);
  const b64 = btoa(String.fromCharCode(...bytes));
  const out = await runCmd("sh", ["-c", `mkdir -p ${shQuote(dir)} && echo ${shQuote(b64)} | base64 -d > ${shQuote(path)}`]);
  if (out.code !== 0) throw new Error(out.stderr || "failed to write opencode config");
};

interface OpencodeModelConfig {
  name?: string;
  variants?: Record<string, { reasoningEffort: string }>;
  limit?: { context: number; output: number };
}

interface OpencodeConfigShape {
  provider?: Record<
    string,
    {
      npm?: string;
      name?: string;
      options?: { baseURL?: string; num_ctx?: number; seed?: number };
      models?: Record<string, OpencodeModelConfig>;
    }
  >;
  tools?: Record<string, boolean>;
  agent?: Record<string, { description?: string; mode?: string; permission?: string; prompt?: string }>;
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
  /** From `ollama.ts`'s `getModelInfo` — decides whether this model's
   * config entry gets a `variants` block at all (see below). */
  thinking: boolean;
  /** The model's real trained context window (`ollama.ts`'s
   * `getModelInfo`), or null when Ollama didn't report one — see
   * `contextWindowFor` below for what happens in that case. */
  contextLength: number | null;
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
// thinking behavior, which is the bug this fixes.
const REASONING_VARIANTS: Record<string, { reasoningEffort: string }> = {
  high: { reasoningEffort: "high" },
  low: { reasoningEffort: "low" },
  off: { reasoningEffort: "none" },
};

// Last resort only — real numbers come from `ollama.ts`'s `getModelInfo`
// (the model's actual trained context length, straight from Ollama's own
// GGUF metadata). This only fires for a model Ollama genuinely reports no
// `model_info` context field for, which hasn't been observed live across
// this machine's pulled models (see `getModelInfo`'s doc comment) — kept as
// a floor rather than left unset so a model that does hit this still gets
// *some* usable window instead of Ollama's own default (a few thousand
// tokens — an agentic tool-call transcript blows through that fast) with no
// `limit` telling opencode about it at all.
const FALLBACK_CONTEXT_WINDOW = { context: 8192, output: 4096 };

// Deterministic output over reproducing whatever Ollama's own random default
// seed picks each run — same reasoning as pinning any other test/debug
// input. Forwarded the same way `num_ctx` already is (a raw Ollama-native
// `options` key nested under the provider's `options` block, not an
// OpenAI-standard request field), since that's the one channel already
// live-verified to actually reach Ollama through opencode's
// `@ai-sdk/openai-compatible` provider — see `num_ctx`'s comment above.
// Owner's choice of constant (42), not derived from anything.
const FIXED_SEED = 42;

/** `limit.context`/`limit.output` for one model's config entry — real
 * context length when Ollama reported one, the flat fallback otherwise.
 * `output` is capped to the context itself: asking a model to *generate*
 * more tokens than its entire window holds isn't meaningful (matters for a
 * small-context model like `smollm:135m`'s real 2048, well under the
 * fallback's 4096 output figure). */
const contextWindowFor = (contextLength: number | null): { context: number; output: number } => {
  const context = contextLength ?? FALLBACK_CONTEXT_WINDOW.context;
  return { context, output: Math.min(FALLBACK_CONTEXT_WINDOW.output, context) };
};

/** Adds any of `models` that aren't already declared under the ollama
 * provider block, creating that block if it doesn't exist yet, and gives a
 * thinking-capable model's entry a `variants` block if it doesn't have one
 * yet, or patches in a missing `off` key if it already has one from before
 * `off` was a real variant (covers a brand-new model, one synced by an
 * older version of this function before `variants` existed, and one synced
 * before `off` was added to `REASONING_VARIANTS`). Also backfills each
 * model's `limit` from its real context length whenever it's missing or
 * stale, so a config written by an older (flat-default) version of this
 * function still gets corrected. The provider's shared `options.num_ctx`
 * (one number, applied to every request against this Ollama instance
 * regardless of which model) is set to the *smallest* real context length
 * seen across `models` this pass — the safe direction, since asking Ollama
 * for more context than the smallest model actually supports is the
 * failure mode that bites, not asking for less than a bigger model could
 * technically hold. Never removes a model or a
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

  const realContextLengths = models.map((m) => m.contextLength).filter((n): n is number => n !== null);
  const numCtx = realContextLengths.length > 0 ? Math.min(...realContextLengths) : FALLBACK_CONTEXT_WINDOW.context;

  config.provider ??= {};
  const existing = config.provider[OLLAMA_PROVIDER_ID];
  const configuredModels = { ...existing?.models };
  let changed = !existing || existing.options?.num_ctx !== numCtx || existing.options?.seed !== FIXED_SEED;
  for (const { name, thinking, contextLength } of models) {
    const limit = contextWindowFor(contextLength);
    const entry = configuredModels[name];
    if (!entry) {
      configuredModels[name] = {
        name,
        limit,
        ...(thinking ? { variants: REASONING_VARIANTS } : {}),
      };
      changed = true;
    } else {
      let next = entry;
      if (thinking && !next.variants) {
        next = { ...next, variants: REASONING_VARIANTS };
        changed = true;
      } else if (thinking && next.variants && !next.variants.off) {
        next = { ...next, variants: { ...next.variants, off: REASONING_VARIANTS.off } };
        changed = true;
      }
      if (!next.limit || next.limit.context !== limit.context) {
        next = { ...next, limit };
        changed = true;
      }
      if (next !== entry) configuredModels[name] = next;
    }
  }
  if (!changed) return false;

  config.provider[OLLAMA_PROVIDER_ID] = {
    npm: existing?.npm ?? "@ai-sdk/openai-compatible",
    name: existing?.name ?? "Ollama (local)",
    options: { baseURL: existing?.options?.baseURL ?? OLLAMA_BASE_URL, num_ctx: numCtx, seed: FIXED_SEED },
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

// `permission: "deny"` alone isn't enough — verified live it correctly
// keeps the tool schema off the completion request (no attempted call, no
// "does not support tools" 400 either), but opencode's *default* system
// prompt is written for a full agentic coding agent regardless: tool-call
// format, task/todo-tracking instructions, "mark it in_progress" workflow
// text. A small model handed that prompt with zero actual tools attached
// doesn't just ignore it — it tries to comply, and spirals into confused
// meta-commentary about tools it can see described but can't call (worse
// than the original bash-hallucination bug this agent exists to prevent).
// This `prompt` completely replaces opencode's default for this agent
// (verified live: switching it eliminates the spiral) rather than just
// gating tools, so it's the one that actually matters here.
const CHAT_AGENT_PROMPT =
  "You are a plain conversational assistant with no tools available. Reply directly in plain text — do not describe a plan, do not mention tools, tasks, or steps you would take.";

/** Declares `config.ts`'s `DEFAULT_CHAT_AGENT` as a primary agent with every
 * tool permission denied and a minimal custom `prompt` (see above). This is
 * a *tool* gate only, not a project-context one — opencode still injects
 * the directory's AGENTS.md/CLAUDE.md into the system prompt regardless of
 * agent (verified live), so a small model can still ramble about project
 * internals on an unrelated prompt. There's no config-level switch to
 * suppress that injection (confirmed against opencode's published config
 * schema — no per-agent or global "skip project instructions" field), and
 * telling the model in `prompt` to ignore project context doesn't work
 * either (verified live against qwen3.5:0.8b: it rambled about the project
 * anyway) — a known limitation of small local models with negative
 * instructions, not something this widget can configure around. Idempotent
 * — a no-op once the agent entry already matches. Same not-hot-reloaded /
 * fails-safe-on-non-JSON rules as `syncOllamaModels`. */
export const syncChatAgent = async (agentID: string): Promise<boolean> => {
  const path = await configPath();
  const config = await readConfig(path);
  if (!config) return false;
  const existing = config.agent?.[agentID];
  if (existing?.mode === "primary" && existing.permission === "deny" && existing.prompt === CHAT_AGENT_PROMPT) {
    return false;
  }

  config.agent = {
    ...config.agent,
    [agentID]: {
      description: "Plain conversation — no tools, no file/shell access.",
      mode: "primary",
      permission: "deny",
      prompt: CHAT_AGENT_PROMPT,
    },
  };
  await writeRaw(path, JSON.stringify(config, null, 2));
  return true;
};
