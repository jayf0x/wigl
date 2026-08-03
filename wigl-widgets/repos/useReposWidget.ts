import { useCallback, useEffect, useState } from "react";
import { hours, useQuery, useStorage } from "@/wigl/hooks";
import { homeDir } from "@/wigl/utils";
import { loadArchivedRepoNames } from "./commands";
import { POLL_INTERVAL_MS, SOURCE_DIR_RELATIVE_TO_HOME } from "./config";
import { scanSourceDir } from "./scan";
import type { ProjectStatus } from "./types";

export const useReposWidget = () => {
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
      const dir = sourceDirOverride || `${await homeDir()}/${SOURCE_DIR_RELATIVE_TO_HOME}`;
      const rows = await scanSourceDir(dir);
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
};
