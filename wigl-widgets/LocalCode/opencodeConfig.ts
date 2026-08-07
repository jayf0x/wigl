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

interface OpencodeConfigShape {
  provider?: Record<
    string,
    {
      npm?: string;
      name?: string;
      options?: { baseURL?: string };
      models?: Record<string, { name?: string }>;
    }
  >;
  [key: string]: unknown;
}

/** Adds any of `modelNames` that aren't already declared under the ollama
 * provider block, creating that block if it doesn't exist yet. Never
 * removes a model — one pulled via `ollama rm` just stops being offered
 * from Ollama's own list, and quietly stays declared in opencode's config
 * (harmless: opencode just can't reach it, same as any misconfigured
 * model). Returns whether the file was actually written, so the caller
 * knows whether an `opencode serve` restart is needed to pick it up (config
 * is NOT hot-reloaded — verified live: editing the file while a server was
 * already running had no effect until restart). Fails safe: a config file
 * that isn't valid JSON (e.g. a user added real `//` comments — this repo
 * doesn't bundle a JSONC-comment-aware parser, see AGENTS.md) is left
 * untouched rather than risking a corrupting rewrite. */
export const syncOllamaModels = async (modelNames: string[]): Promise<boolean> => {
  if (modelNames.length === 0) return false;
  const path = await configPath();
  const raw = await readRaw(path);

  let config: OpencodeConfigShape;
  try {
    config = raw ? (JSON.parse(raw) as OpencodeConfigShape) : { $schema: "https://opencode.ai/config.json" };
  } catch (e) {
    console.error("[LocalCode] opencode.jsonc isn't plain JSON — skipping Ollama model sync", e);
    return false;
  }

  config.provider ??= {};
  const existing = config.provider[OLLAMA_PROVIDER_ID];
  const models = { ...existing?.models };
  let changed = !existing;
  for (const name of modelNames) {
    if (!(name in models)) {
      models[name] = { name };
      changed = true;
    }
  }
  if (!changed) return false;

  config.provider[OLLAMA_PROVIDER_ID] = {
    npm: existing?.npm ?? "@ai-sdk/openai-compatible",
    name: existing?.name ?? "Ollama (local)",
    options: { baseURL: existing?.options?.baseURL ?? OLLAMA_BASE_URL },
    models,
  };

  await writeRaw(path, JSON.stringify(config, null, 2));
  return true;
};
