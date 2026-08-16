// Owns exactly one `opencode serve` process for the widget's lifetime — no
// widget instance currently unmounts-and-remounts the server on its own
// (see AGENTS.md's "server lifecycle" section for the tradeoffs of this
// choice, and what a multi-monitor / multi-instance setup would need).
import { useEffect, useRef, useState } from "react";
import { DEFAULT_CHAT_AGENT } from "./config";
import { listOllamaModels, modelSupportsThinking } from "./ollama";
import { disableSkillTool, type OllamaModelSync, syncChatAgent, syncOllamaModels } from "./opencodeConfig";
import { type OpencodeServerHandle, startOpencodeServer } from "./serverProcess";

export type ServerStatus = "connecting" | "online" | "offline";

// Config isn't hot-reloaded (verified live — see opencodeConfig.ts), so
// whatever Ollama models exist (and their thinking capability, so
// opencodeConfig.ts knows which get a reasoning-effort `variants` block —
// see Composer.tsx) must be resolved *before* `serve` starts, not after.
// Best-effort and time-boxed as a whole: Ollama might not even be running,
// and this must never hang the server startup waiting for it.
const OLLAMA_SYNC_TIMEOUT_MS = 2000;

// How often to check for a newly-pulled Ollama model once the server is
// already up — config isn't hot-reloaded (see opencodeConfig.ts), so the
// only way a `ollama pull` mid-session ever becomes selectable is noticing
// the catalog changed and restarting `serve` ourselves (backlog.md B5).
const OLLAMA_POLL_INTERVAL_MS = 15_000;

const prepareOllamaModelSync = async (isCancelled: () => boolean): Promise<OllamaModelSync[]> => {
  const names = await listOllamaModels();
  // React 19 StrictMode (main.tsx) deliberately double-invokes this effect
  // on mount — verified live via the Ollama server's own request log: two
  // near-simultaneous `GET /api/tags` plus a full `POST /api/show` fanout
  // for every pulled model, twice. Bailing here (right after the one
  // network round trip that already happened) is what stops the throwaway
  // invocation from also firing the `/api/show` fanout for nothing.
  if (isCancelled()) return [];
  return Promise.all(names.map(async (name) => ({ name, thinking: await modelSupportsThinking(name) })));
};

// Sequential, not parallel: both steps read-modify-write the same
// opencode.jsonc, and running them concurrently would race (the second
// write could silently clobber the first). Neither is Ollama-availability
// dependent for the skill-tool step, so only the model sync half gets the
// timeout race — disabling the skill tool is a local file write with
// nothing external to hang on. Returns the model names actually seen, so
// the caller can remember what's already synced and later notice a
// `ollama pull` that added to that set.
const syncConfigBeforeStart = async (isCancelled: () => boolean): Promise<string[]> => {
  const models = await Promise.race([
    prepareOllamaModelSync(isCancelled),
    new Promise<OllamaModelSync[]>((resolve) => setTimeout(() => resolve([]), OLLAMA_SYNC_TIMEOUT_MS)),
  ]);
  if (isCancelled()) return [];
  if (models.length > 0) await syncOllamaModels(models).catch((e) => console.error("[LocalCode]", e));
  await disableSkillTool().catch((e) => console.error("[LocalCode]", e));
  await syncChatAgent(DEFAULT_CHAT_AGENT).catch((e) => console.error("[LocalCode]", e));
  return models.map((m) => m.name);
};

// `directory` is where opencode's sessions actually get scoped — see
// serverProcess.ts's `startOpencodeServer` doc comment: it's the server
// process's own cwd, not anything the client requests per-session. The
// widget can't spawn `serve` before it knows this, so the effect below
// waits for a non-empty `directory` rather than starting eagerly on mount.
export const useOpencodeServer = (directory: string | null) => {
  const [status, setStatus] = useState<ServerStatus>("connecting");
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const handleRef = useRef<OpencodeServerHandle | null>(null);
  const [attempt, setAttempt] = useState(0);
  const syncedModelsRef = useRef<Set<string>>(new Set());

  const restart = () => setAttempt((n) => n + 1);

  useEffect(() => {
    if (!directory) return;
    let cancelled = false;
    setStatus("connecting");
    syncConfigBeforeStart(() => cancelled)
      .then((names) => {
        syncedModelsRef.current = new Set(names);
        if (cancelled) return undefined;
        return startOpencodeServer(directory);
      })
      .then((handle) => {
        if (!handle) return;
        if (cancelled) {
          handle.stop().catch(() => {});
          return;
        }
        handleRef.current = handle;
        setBaseUrl(handle.baseUrl);
        setStatus("online");
      })
      .catch((e) => {
        console.error("[LocalCode] failed to start opencode server", e);
        if (!cancelled) setStatus("offline");
      });
    return () => {
      cancelled = true;
      handleRef.current?.stop().catch(() => {});
      handleRef.current = null;
    };
  }, [attempt, directory]);

  // Notices a model pulled via `ollama pull` while this widget's server is
  // already running — config isn't hot-reloaded (opencodeConfig.ts), so the
  // only way it becomes selectable is restarting `serve` after re-syncing
  // (backlog.md B5). Only *new* names trigger it: a model removed via
  // `ollama rm` staying configured is harmless (syncOllamaModels never
  // removes entries either) and not worth a restart on its own.
  useEffect(() => {
    if (status !== "online") return;
    const interval = setInterval(() => {
      listOllamaModels()
        .then((names) => {
          if (names.some((name) => !syncedModelsRef.current.has(name))) restart();
        })
        .catch(() => {});
    }, OLLAMA_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [status]);

  return { status, baseUrl, restart };
};
