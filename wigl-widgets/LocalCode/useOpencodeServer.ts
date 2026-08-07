// Owns exactly one `opencode serve` process for the widget's lifetime — no
// widget instance currently unmounts-and-remounts the server on its own
// (see AGENTS.md's "server lifecycle" section for the tradeoffs of this
// choice, and what a multi-monitor / multi-instance setup would need).
import { useEffect, useRef, useState } from "react";
import { listOllamaModels } from "./ollama";
import { syncOllamaModels } from "./opencodeConfig";
import { type OpencodeServerHandle, startOpencodeServer } from "./serverProcess";

export type ServerStatus = "connecting" | "online" | "offline";

// Config isn't hot-reloaded (verified live — see opencodeConfig.ts), so
// whatever Ollama models exist must be synced into opencode's config
// *before* `serve` starts, not after. Best-effort and time-boxed: Ollama
// might not even be running, and this must never hang the server startup
// waiting for it.
const OLLAMA_SYNC_TIMEOUT_MS = 2000;
const syncOllamaBeforeStart = async () => {
  const models = await Promise.race([
    listOllamaModels(),
    new Promise<string[]>((resolve) => setTimeout(() => resolve([]), OLLAMA_SYNC_TIMEOUT_MS)),
  ]);
  if (models.length > 0) await syncOllamaModels(models).catch((e) => console.error("[LocalCode]", e));
};

export const useOpencodeServer = () => {
  const [status, setStatus] = useState<ServerStatus>("connecting");
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const handleRef = useRef<OpencodeServerHandle | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("connecting");
    syncOllamaBeforeStart()
      .catch(() => {})
      .then(() => {
        if (cancelled) return undefined;
        return startOpencodeServer();
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
  }, [attempt]);

  const restart = () => setAttempt((n) => n + 1);

  return { status, baseUrl, restart };
};
