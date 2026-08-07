// Owns the lifetime of the `opencode serve` process this widget talks to.
// One instance per session directory would be wasteful — opencode's server
// is directory-agnostic (a session carries its own `directory`), so one
// server process serves every session this widget knows about, same as
// `opencode serve` is meant to be used as a personal daemon.
import { runCmdBackground } from "@/wigl/utils";

const PORT_RE = /listening on http:\/\/127\.0\.0\.1:(\d+)/;

// bun global installs land in ~/.bun/bin, which a GUI-launched shell's
// minimal PATH often doesn't include — same gap `commands.ts` in the repos
// widget works around for `gh`/editors. Try the common absolute paths
// first, fall back to whatever `opencode` resolves to on PATH.
const OPENCODE_CANDIDATES = ["~/.bun/bin/opencode", "/usr/local/bin/opencode", "opencode"];

export interface OpencodeServerHandle {
  baseUrl: string;
  stop: () => Promise<void>;
}

/** Spawns `opencode serve` on a random local port and resolves once it's
 * confirmed listening. Rejects if none of the candidate binaries start
 * within `timeoutMs` — the caller (useOpencodeServer) turns that into an
 * "offline" status rather than a crash. */
export const startOpencodeServer = (timeoutMs = 8000): Promise<OpencodeServerHandle> =>
  new Promise((resolve, reject) => {
    let settled = false;
    let stopFn: (() => Promise<void>) | null = null;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stopFn?.().catch(() => {});
      reject(new Error("opencode serve didn't report a listening port in time"));
    }, timeoutMs);

    const tryCandidate = async (index: number): Promise<void> => {
      if (index >= OPENCODE_CANDIDATES.length) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("opencode binary not found (tried: " + OPENCODE_CANDIDATES.join(", ") + ")"));
        }
        return;
      }
      const bin = OPENCODE_CANDIDATES[index];
      try {
        const { stop } = await runCmdBackground(
          "sh",
          ["-c", `${bin} serve --port 0 --hostname 127.0.0.1 2>&1`],
          (line) => {
            const match = line.match(PORT_RE);
            if (match && !settled) {
              settled = true;
              clearTimeout(timer);
              stopFn = stop;
              resolve({ baseUrl: `http://127.0.0.1:${match[1]}`, stop });
            }
          },
        );
        stopFn = stop;
      } catch {
        // this candidate isn't on disk / didn't spawn — try the next one
      }
      // give this candidate a moment to either report a port or fail before
      // moving on, so we don't race multiple `opencode serve` instances
      setTimeout(() => {
        if (!settled) tryCandidate(index + 1);
      }, 1200);
    };

    tryCandidate(0);
  });
