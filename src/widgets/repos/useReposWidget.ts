import { homeDir, join } from "@tauri-apps/api/path";
import { Command } from "@tauri-apps/plugin-shell";
import { useCallback, useEffect, useState } from "react";
import { hours, isMacos, useQuery, useStorage } from "@/wigl";
import { loadArchivedRepoNames, shQuote } from "./commands";
import { POLL_INTERVAL_MS, SOURCE_DIR_RELATIVE_TO_HOME } from "./config";
import type { ProjectStatus, RepoScanRow } from "./types";

// Locates scripts/repos-scan.ts without assuming where this checkout lives
// on disk. `bun run verify`/`tauri dev` always run the binary in place at
// <repo>/src-tauri/target/debug/wigl, so the repo root is a fixed 4
// directories up from the running binary itself. Tauri's `executableDir()`
// looks like the right API for "where is the binary" but isn't — on Linux
// it resolves to the XDG user-executable dir (`~/.local/bin`), unrelated to
// where this binary actually runs from; confirmed by the earlier version of
// this function producing "/home/scripts/repos-scan.ts". `/proc/$PPID/exe`
// resolves the *actual* running binary instead — `$PPID` inside `sh -c` is
// wigl's own pid, since tauri-plugin-shell spawns it as a direct child.
async function ownExePath(): Promise<string> {
  const cmd = (await isMacos()) ? "ps -o comm= -p $PPID" : "readlink -f /proc/$PPID/exe";
  const out = await Command.create("sh", ["-c", cmd]).execute();
  const exePath = out.stdout.trim();
  if (out.code !== 0 || !exePath) throw new Error(out.stderr || "could not resolve wigl's own executable path");
  return exePath;
}

// The running binary's location can't change mid-session, so this is worth
// resolving once and reusing — without caching, `refresh()` (every poll
// tick, every manual click, forever) would spawn a `ps`/`readlink` process
// just to re-derive the same path.
let scanScriptPathCache: Promise<string> | null = null;
function scanScriptPath(): Promise<string> {
  if (!scanScriptPathCache) {
    scanScriptPathCache = (async () => {
      const repoRoot = await join(await ownExePath(), "..", "..", "..", "..");
      return join(repoRoot, "scripts", "repos-scan.ts");
    })();
  }
  return scanScriptPathCache;
}

// GUI-launched shells often lack ~/.bun/bin on PATH (it's added by shell rc
// files, which a WebView-spawned `sh -c` doesn't source) — same problem as
// the VS Code CLI in openInEditor below, same fix: try the absolute install
// path first, fall back to whatever `bun` resolves to on PATH. Throws with
// the last attempt's stderr on total failure rather than swallowing it —
// this used to return `[]` silently, which is indistinguishable in the UI
// from "the folder is just empty".
// Whichever candidate works is remembered for the rest of the session, so a
// machine where the absolute path doesn't resolve (or does) doesn't pay for
// a failed spawn attempt on every single poll tick.
let workingBunBin: string | null = null;

async function runBunScan(scriptPath: string, sourceDir: string): Promise<RepoScanRow[]> {
  const bunAbsolute = await join(await homeDir(), ".bun/bin/bun");
  const candidates = workingBunBin ? [workingBunBin] : [bunAbsolute, "bun"];
  let lastErr = "";
  for (const bun of candidates) {
    const out = await Command.create("sh", [
      "-c",
      `${shQuote(bun)} ${shQuote(scriptPath)} ${shQuote(sourceDir)}`,
    ]).execute();
    if (out.code === 0) {
      workingBunBin = bun;
      return JSON.parse(out.stdout || "[]");
    }
    lastErr = out.stderr || `exit code ${out.code}`;
  }
  workingBunBin = null;
  throw new Error(`scan failed: ${lastErr}`);
}

export function useReposWidget() {
  const [projects, setProjects] = useState<ProjectStatus[]>([]);
  const [sourceDir, setSourceDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);
  // User-set absolute path, overriding SOURCE_DIR_RELATIVE_TO_HOME once set
  // via the widget's settings panel — see Settings.tsx. null until the user
  // ever saves one, which is also what `settingsLoading` guards below (the
  // sqlite3 read hasn't resolved yet, so a stored override may still be
  // incoming as `null`'s initial render).
  const [sourceDirOverride, setSourceDirOverride, { loading: settingsLoading }] = useStorage<string | null>(
    "repos_source_dir",
    null,
  );
  // gh-backed, rarely changes and has its own rate limit — cached a day,
  // persisted so a restart doesn't re-hit the API immediately.
  const [archived] = useQuery({ key: "repos_archived", fn: loadArchivedRepoNames, stale: hours(24), useSql: true });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const dir = sourceDirOverride || (await join(await homeDir(), SOURCE_DIR_RELATIVE_TO_HOME));
      const scriptPath = await scanScriptPath();
      const rows = await runBunScan(scriptPath, dir);
      setSourceDir(dir);
      setScanError(null);
      setProjects(rows.map((row) => ({ ...row, path: `${dir}/${row.name}` })));
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sourceDirOverride]);

  useEffect(() => {
    // Wait for the stored override to actually load first — otherwise the
    // first scan always runs against the default dir, then immediately
    // re-runs against the real one once the sqlite3 read resolves.
    if (settingsLoading) return;
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh, settingsLoading]);

  const archivedNames = new Set(archived);
  const visible = projects.filter((p) => !archivedNames.has(p.name));
  // Raw scan result, unfiltered by archived status — "is this repo already
  // downloaded" cares about what's on disk, not whether it's shown in the
  // main (archived-filtered) list.
  const localNames = new Set(projects.map((p) => p.name));

  return { projects: visible, localNames, sourceDir, sourceDirOverride, setSourceDirOverride, scanError, loading, refresh };
}
