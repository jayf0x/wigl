// Owns exactly one `opencode serve` process for the widget's lifetime — no
// widget instance currently unmounts-and-remounts the server on its own
// (see AGENTS.md's "server lifecycle" section for the tradeoffs of this
// choice, and what a multi-monitor / multi-instance setup would need).
import { useEffect, useRef, useState } from "react";
import { DEFAULT_CHAT_AGENT } from "./config";
import { isOllamaReachable, listOllamaModels, modelSupportsThinking, startOllama } from "./ollama";
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
// nothing external to hang on.
const syncConfigBeforeStart = async (isCancelled: () => boolean): Promise<void> => {
  const models = await Promise.race([
    prepareOllamaModelSync(isCancelled),
    new Promise<OllamaModelSync[]>((resolve) => setTimeout(() => resolve([]), OLLAMA_SYNC_TIMEOUT_MS)),
  ]);
  if (isCancelled()) return;
  if (models.length > 0) await syncOllamaModels(models).catch((e) => console.error("[LocalCode]", e));
  await disableSkillTool().catch((e) => console.error("[LocalCode]", e));
  await syncChatAgent(DEFAULT_CHAT_AGENT).catch((e) => console.error("[LocalCode]", e));
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

  // — Ollama reachability ————————————————————————————————————————————
  // Used to poll `listOllamaModels()` every 15s for as long as the server
  // was "online", purely to notice a model pulled mid-session. Verified
  // live this was expensive for what it bought: a GET plus a POST /api/show
  // per model, forever, in the background, whether or not anything ever
  // changed — and it gave no positive signal either (an unreachable Ollama
  // just silently kept polling with nothing to show for it). Replaced with
  // a check on connect/reload only, surfaced as `ollamaOnline` so the UI can
  // actually show "Ollama isn't running" instead of nothing — see
  // index.tsx's status dot. `reloadModels` re-runs the check plus a full
  // `restart()` (config isn't hot-reloaded, same reasoning as before) for a
  // manual "I just pulled a model" trigger instead of an automatic one.
  const [ollamaOnline, setOllamaOnline] = useState<boolean | null>(null);
  const [ollamaStarting, setOllamaStarting] = useState(false);

  const restart = () => setAttempt((n) => n + 1);
  const reloadModels = () => {
    isOllamaReachable().then(setOllamaOnline);
    restart();
  };

  // Only offered while `ollamaOnline === false` (see index.tsx) — normally
  // Ollama is already running as a system service (F4 in backlog.md), this
  // is the fallback for when it isn't.
  const startOllamaNow = () => {
    if (ollamaStarting) return;
    setOllamaStarting(true);
    startOllama()
      .then(() => reloadModels())
      .catch((e) => console.error("[LocalCode] failed to start ollama", e))
      .finally(() => setOllamaStarting(false));
  };

  useEffect(() => {
    if (!directory) return;
    let cancelled = false;
    setStatus("connecting");
    isOllamaReachable().then((reachable) => {
      if (!cancelled) setOllamaOnline(reachable);
    });
    syncConfigBeforeStart(() => cancelled)
      .then(() => {
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

  return { status, baseUrl, ollamaOnline, ollamaStarting, restart, reloadModels, startOllamaNow };
};
