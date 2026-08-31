// Phase 4 (optional): if Music Assistant isn't answering and the owner has
// opted in, try to `docker start` the container SETUP.md's `docker run`
// created. Deliberately minimal — it never creates the container (that's a
// one-time step in SETUP.md), only restarts a stopped one. The container is
// created with `--restart unless-stopped`, so this only matters when Docker
// itself was down or the container was stopped by hand.

import { runCmd } from "@/wigl/utils";

// GUI-launched shells have a minimal PATH (see docs/widgets.md) — Docker
// Desktop's CLI lives here on macOS; try the absolute path first, bare name
// as the fallback for machines where it resolves.
const DOCKER_CANDIDATES = ["/usr/local/bin/docker", "/opt/homebrew/bin/docker", "docker"];

const sh = (cmd: string) => runCmd("sh", ["-c", cmd]);

/** Reachable if `GET /info` answers at all. */
export const maReachable = async (base: string): Promise<boolean> => {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2_000);
    const res = await fetch(`${base}/info`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
};

/** Best-effort `docker start <container>`. Returns true if the command exited
 * 0 with some docker binary; the caller still re-checks reachability. */
export const startMaContainer = async (container: string): Promise<boolean> => {
  for (const bin of DOCKER_CANDIDATES) {
    const out = await sh(`${bin} start ${container} 2>&1`).catch(() => null);
    if (out && out.code === 0) return true;
    // `docker` found but container missing / daemon down → don't try more bins.
    if (out && /Cannot connect to the Docker daemon|No such container/i.test(out.stdout)) return false;
  }
  return false;
};
