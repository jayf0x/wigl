// Owns exactly one `opencode serve` process for the widget's lifetime — no
// widget instance currently unmounts-and-remounts the server on its own
// (see AGENTS.md's "server lifecycle" section for the tradeoffs of this
// choice, and what a multi-monitor / multi-instance setup would need).
import { useEffect, useRef, useState } from "react";
import { type OpencodeServerHandle, startOpencodeServer } from "./serverProcess";

export type ServerStatus = "connecting" | "online" | "offline";

export const useOpencodeServer = () => {
  const [status, setStatus] = useState<ServerStatus>("connecting");
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const handleRef = useRef<OpencodeServerHandle | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("connecting");
    startOpencodeServer()
      .then((handle) => {
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
