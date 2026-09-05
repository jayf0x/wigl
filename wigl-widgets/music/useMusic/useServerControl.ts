// P4 — the offline panel's Docker recovery surface. Independent of the
// connection/queue state beyond `httpBase` and the shared `setError`/
// `setAttempt` setters (both owned by useConnection) it needs to report a
// failure and trigger a reconnect once the container is up.
import { useCallback, useState } from "react";
import { runCmd } from "@/wigl/utils";
import { dockerState, maReachable, startDockerDesktop, startMaContainer } from "../serverProcess";
import { MA_CONTAINER } from "../music.config";

export const useServerControl = ({
  httpBase,
  setError,
  setAttempt,
}: {
  httpBase: string;
  setError: (e: string | null) => void;
  setAttempt: (fn: (n: number) => number) => void;
}) => {
  const [serverStarting, setServerStarting] = useState(false);

  const openServer = useCallback(() => {
    runCmd("sh", ["-c", `open ${httpBase} || xdg-open ${httpBase}`]).catch((e) =>
      console.warn("[music] openServer", e),
    );
  }, [httpBase]);

  /** P4 — bring the backend up from the offline panel: start the Docker daemon
   * if it's down, then `docker start` the container, then poll for the server
   * and trigger a reconnect. One button; it figures out which step is needed. */
  const startServer = useCallback(async () => {
    if (serverStarting) return;
    setServerStarting(true);
    setError(null);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      let ds = await dockerState();
      if (ds === "no-docker") {
        setError("Docker isn’t installed on this machine — see the widget’s setup notes.");
        return;
      }
      if (ds === "daemon-down") {
        const r = await startDockerDesktop();
        if (!r.ok) {
          setError(r.message);
          return;
        }
        for (let i = 0; i < 24 && ds !== "up"; i++) {
          await wait(2000);
          ds = await dockerState();
        }
        if (ds !== "up") {
          setError("Docker is still starting. Give it a moment, then hit retry.");
          return;
        }
      }
      await startMaContainer(MA_CONTAINER);
      for (let i = 0; i < 15 && !(await maReachable(httpBase)); i++) await wait(1500);
    } finally {
      setServerStarting(false);
      setAttempt((n) => n + 1); // reconnect whatever the outcome
    }
  }, [httpBase, serverStarting, setError, setAttempt]);

  return { openServer, startServer, serverStarting };
};
