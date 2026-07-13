import { homeDir, join } from "@tauri-apps/api/path";
import { Command } from "@tauri-apps/plugin-shell";
import { useCallback, useEffect, useState } from "react";
import { hours, useQuery } from "@/wigl";
import { loadArchivedRepoNames, shQuote } from "./commands";
import { POLL_INTERVAL_MS, REPO_ROOT_RELATIVE_TO_HOME, SOURCE_DIR_RELATIVE_TO_HOME } from "./config";
import type { ProjectStatus, RepoScanRow } from "./types";

// GUI-launched shells often lack ~/.bun/bin on PATH (it's added by shell rc
// files, which a WebView-spawned `sh -c` doesn't source) — same problem as
// the VS Code CLI in openInEditor below, same fix: try the absolute install
// path first, fall back to whatever `bun` resolves to on PATH.
async function runBunScan(scriptPath: string, sourceDir: string): Promise<RepoScanRow[]> {
  const bunAbsolute = await join(await homeDir(), ".bun/bin/bun");
  for (const bun of [bunAbsolute, "bun"]) {
    const out = await Command.create("sh", [
      "-c",
      `${shQuote(bun)} ${shQuote(scriptPath)} ${shQuote(sourceDir)}`,
    ]).execute();
    if (out.code === 0) return JSON.parse(out.stdout || "[]");
  }
  return [];
}

export function useReposWidget() {
  const [projects, setProjects] = useState<ProjectStatus[]>([]);
  const [loading, setLoading] = useState(true);
  // gh-backed, rarely changes and has its own rate limit — cached a day,
  // persisted so a restart doesn't re-hit the API immediately.
  const [archived] = useQuery({ key: "repos_archived", fn: loadArchivedRepoNames, stale: hours(24), useSql: true });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const home = await homeDir();
      const sourceDir = await join(home, SOURCE_DIR_RELATIVE_TO_HOME);
      const scriptPath = await join(home, REPO_ROOT_RELATIVE_TO_HOME, "scripts/repos-scan.ts");
      const rows = await runBunScan(scriptPath, sourceDir);
      setProjects(rows.map((row) => ({ ...row, path: `${sourceDir}/${row.name}` })));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const archivedNames = new Set(archived);
  const visible = projects.filter((p) => !archivedNames.has(p.name));

  return { projects: visible, loading, refresh };
}
