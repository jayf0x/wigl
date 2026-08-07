// Owns exactly one `opencode serve` process for the widget's lifetime — no
// widget instance currently unmounts-and-remounts the server on its own
// (see AGENTS.md's "server lifecycle" section for the tradeoffs of this
// choice, and what a multi-monitor / multi-instance setup would need).
import { useEffect, useRef, useState } from "react";
import { listOllamaModels, modelSupportsThinking } from "./ollama";
import { disableSkillTool, type OllamaModelSync, syncOllamaModels } from "./opencodeConfig";
import { type OpencodeServerHandle, startOpencodeServer } from "./serverProcess";

export type ServerStatus = "connecting" | "online" | "offline";

// Config isn't hot-reloaded (verified live — see opencodeConfig.ts), so
// whatever Ollama models exist (and their thinking capability, so
// opencodeConfig.ts knows which get a reasoning-effort `variants` block —
// see Composer.tsx) must be resolved *before* `serve` starts, not after.
// Best-effort and time-boxed as a whole: Ollama might not even be running,
// and this must never hang the server startup waiting for it.
const OLLAMA_SYNC_TIMEOUT_MS = 2000;

const prepareOllamaModelSync = async (): Promise<OllamaModelSync[]> => {
  const names = await listOllamaModels();
  return Promise.all(names.map(async (name) => ({ name, thinking: await modelSupportsThinking(name) })));
};

// Sequential, not parallel: both steps read-modify-write the same
// opencode.jsonc, and running them concurrently would race (the second
// write could silently clobber the first). Neither is Ollama-availability
// dependent for the skill-tool step, so only the model sync half gets the
// timeout race — disabling the skill tool is a local file write with
// nothing external to hang on.
const syncConfigBeforeStart = async () => {
  const models = await Promise.race([
    prepareOllamaModelSync(),
    new Promise<OllamaModelSync[]>((resolve) => setTimeout(() => resolve([]), OLLAMA_SYNC_TIMEOUT_MS)),
  ]);
  if (models.length > 0) await syncOllamaModels(models).catch((e) => console.error("[LocalCode]", e));
  await disableSkillTool().catch((e) => console.error("[LocalCode]", e));
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

  useEffect(() => {
    if (!directory) return;
    let cancelled = false;
    setStatus("connecting");
    syncConfigBeforeStart()
      .catch(() => {})
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

  const restart = () => setAttempt((n) => n + 1);

  return { status, baseUrl, restart };
};
