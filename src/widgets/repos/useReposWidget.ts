import { homeDir, join, resolveResource } from "@tauri-apps/api/path";
import { Command } from "@tauri-apps/plugin-shell";
import { useCallback, useEffect, useState } from "react";
import { hours, useQuery, useStorage } from "@/wigl";
import { loadArchivedRepoNames, shQuote } from "./commands";
import { POLL_INTERVAL_MS, SOURCE_DIR_RELATIVE_TO_HOME } from "./config";
import type { ProjectStatus, RepoScanRow } from "./types";

// Locates scripts/repos-scan.ts via Tauri's own resource resolution
// (declared in tauri.conf.json's bundle.resources) instead of hand-deriving
// it from the running binary's path. That's the actual failure mode this
// replaced: a previous version counted a fixed number of ".." hops up from
// the binary, which broke the moment the binary ran from somewhere the hop
// count didn't expect (a packaged macOS .app nests it several directories
// deeper than a plain `cargo build` binary does). `resolveResource` is
// Tauri's designed-for-this primitive — it already knows the difference
// between dev and every bundled target, so this can't drift out of sync
// with packaging again.
let scanScriptPathCache: Promise<string> | null = null;
function scanScriptPath(): Promise<string> {
  if (!scanScriptPathCache) scanScriptPathCache = resolveResource("scripts/repos-scan.ts");
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

  return {
    projects: visible,
    localNames,
    sourceDir,
    sourceDirOverride,
    setSourceDirOverride,
    scanError,
    loading,
    refresh,
  };
}
