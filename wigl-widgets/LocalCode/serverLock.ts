// Lets a second widget instance (another monitor's realm — each `Desktop`
// is its own JS realm and process, see docs/architecture.md) discover and
// reuse an `opencode serve` already running for the same `cwd`, instead of
// silently spawning a second one with its own disconnected session list.
// The lock file is the only thing two separate realms share on disk for
// this purpose — no IPC between them otherwise.
import { runCmd } from "@/wigl/utils";

// Cheap non-crypto hash so the lock file name never needs escaping — same
// cwd always maps to the same file, collisions across unrelated cwds aren't
// a real concern for a local dev-machine lock file.
const hashCwd = (cwd: string): string => {
  let h = 5381;
  for (let i = 0; i < cwd.length; i++) h = ((h << 5) + h + cwd.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

const lockPath = (cwd: string) => `/tmp/wigl-localcode-${hashCwd(cwd)}.lock`;

const HEALTH_TIMEOUT_MS = 1500;

const isAlive = async (baseUrl: string): Promise<boolean> => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(`${baseUrl}/session`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
};

/** Any `opencode serve` process already running, found by scanning `pgrep`
 * output and asking `lsof` which port its listening socket bound to — opencode
 * defaults `--port` to 0 (random) same as this widget does, so there's no
 * fixed "default port" to guess at; this is the only way to find a server
 * neither this widget nor `recordRunningServer` knows about (started by hand,
 * or by an instance whose lock file got cleared). */
const findExternalServer = async (): Promise<string | null> => {
  const pgrep = await runCmd("sh", ["-c", "pgrep -f 'opencode serve'"]).catch(() => null);
  const pids = pgrep?.stdout.trim().split(/\s+/).filter(Boolean) ?? [];
  for (const pid of pids) {
    const lsof = await runCmd("sh", ["-c", `lsof -a -p ${pid} -iTCP -sTCP:LISTEN -Pn`]).catch(() => null);
    const match = lsof?.stdout.match(/:(\d+)\s*\(LISTEN\)/);
    if (!match) continue;
    const baseUrl = `http://127.0.0.1:${match[1]}`;
    if (await isAlive(baseUrl)) return baseUrl;
  }
  return null;
};

/** Null if no other instance (or hand-started process) has a live server for
 * this `cwd` — caller should spawn its own and call `recordRunningServer`. */
export const findRunningServer = async (cwd: string): Promise<string | null> => {
  const out = await runCmd("cat", [lockPath(cwd)]).catch(() => null);
  if (out && out.code === 0) {
    const port = out.stdout.trim();
    if (/^\d+$/.test(port)) {
      const baseUrl = `http://127.0.0.1:${port}`;
      if (await isAlive(baseUrl)) return baseUrl;
    }
  }
  return findExternalServer();
};

export const recordRunningServer = (cwd: string, baseUrl: string): Promise<void> => {
  const port = baseUrl.split(":").pop();
  return runCmd("sh", ["-c", `echo "${port}" > "${lockPath(cwd)}"`]).then(() => undefined);
};

// ponytail: only the instance that spawned the process clears the lock, and
// only right before killing it — a borrower whose owner quits mid-session
// just loses its connection (same single-owner-lifecycle ceiling
// useOpencodeServer.ts already documents), no reference counting here.
export const clearRunningServer = (cwd: string): Promise<void> =>
  runCmd("rm", ["-f", lockPath(cwd)]).then(() => undefined);
