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

/** First docker binary that resolves on this machine, or null. */
const findDocker = async (): Promise<string | null> => {
  for (const bin of DOCKER_CANDIDATES) {
    const out = await sh(`command -v ${bin} >/dev/null 2>&1 && echo ${bin}`).catch(() => null);
    if (out?.stdout.trim()) return out.stdout.trim();
  }
  return null;
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

export type OpResult = { ok: boolean; message: string };

const run = async (cmd: string): Promise<OpResult> => {
  const docker = await findDocker();
  if (!docker) return { ok: false, message: "Docker CLI not found on PATH" };
  const out = await sh(cmd.replaceAll("docker ", `${docker} `) + " 2>&1").catch(() => null);
  if (!out) return { ok: false, message: "command failed to run" };
  return { ok: out.code === 0, message: (out.stdout || "").trim().split("\n").pop() || "" };
};

/** `docker restart` — quick, non-destructive. */
export const restartMaContainer = (container: string): Promise<OpResult> =>
  run(`docker restart ${container}`);

/** Wipe MA's `.cache` dir (image proxy + provider caches — MA rebuilds it) and
 * restart. Never touches `library.db` / `auth.db` / `settings.json` / playlists. */
export const clearMaCache = async (container: string): Promise<OpResult> => {
  const wipe = await run(`docker exec ${container} sh -c 'rm -rf /data/.cache/* /data/*.log.1'`);
  if (!wipe.ok) return wipe;
  return restartMaContainer(container);
};

/** Pull `image` and recreate `container` with the same ports + mounts it has
 * now (read via `docker inspect`), so onboarding / providers survive. Slow —
 * the pull can take minutes. */
export const updateMaImage = async (container: string, image: string): Promise<OpResult> => {
  const docker = await findDocker();
  if (!docker) return { ok: false, message: "Docker CLI not found on PATH" };
  // Preserve the exact port + volume config of the running container.
  const insp = await sh(
    `${docker} inspect ${container} --format ` +
      `'{{range $p,$_ := .HostConfig.PortBindings}}-p {{(index $_ 0).HostPort}}:{{$p}} {{end}}` +
      `{{range .Mounts}}-v {{.Source}}:{{.Destination}} {{end}}' 2>&1`,
  ).catch(() => null);
  const args = insp?.stdout.trim().replaceAll("/tcp", "");
  if (!insp || insp.code !== 0 || !args?.includes("-v ")) {
    return { ok: false, message: "couldn't read the container's config — update it via SETUP.md" };
  }
  const pull = await sh(`${docker} pull ${image} 2>&1`).catch(() => null);
  if (!pull || pull.code !== 0) return { ok: false, message: "pull failed — check your connection" };
  await sh(`${docker} rm -f ${container} 2>&1`).catch(() => null);
  const create = await sh(
    `${docker} run -d --name ${container} --restart unless-stopped ${args} ${image} 2>&1`,
  ).catch(() => null);
  if (!create || create.code !== 0) {
    return { ok: false, message: "recreate failed — see SETUP.md to run it by hand" };
  }
  return { ok: true, message: "updated — MA is restarting" };
};
