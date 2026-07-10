import { useCallback, useEffect, useState } from "react";
import { Command } from "@tauri-apps/plugin-shell";
import { homeDir, join } from "@tauri-apps/api/path";
import { POLL_INTERVAL_MS, SOURCE_DIR_RELATIVE_TO_HOME } from "./config";

export type ReleaseStatus = "unreleased" | "clean" | "error";

export interface ProjectStatus {
  name: string;
  path: string;
  status: ReleaseStatus;
  lastCommit: number; // epoch seconds, 0 if unknown
  error?: string;
}

// One shell round-trip per poll: scan SOURCE_DIR one level deep, and for each
// directory decide dirty/tagged/errored. Mirrors .idea/example.widget.jsx,
// minus the npm:deploy gate — every repo gets checked the same way.
const scanScript = (sourceDir: string) => `
cd "${sourceDir}" 2>/dev/null || exit 0
for d in */; do
  d="\${d%/}"
  if ! git -C "$d" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "$d|error|0|not a git repository"
    continue
  fi
  ct=$(git -C "$d" log -1 --format=%ct 2>/dev/null)
  tag=$(git -C "$d" describe --tags --abbrev=0 2>/dev/null)
  dirty=$(git -C "$d" status --porcelain 2>/dev/null)
  if [ -z "$tag" ]; then
    state="unreleased"
  else
    ahead=$(git -C "$d" rev-list "$tag"..HEAD --count 2>/dev/null)
    if [ -n "$dirty" ] || [ "\${ahead:-0}" != "0" ]; then
      state="unreleased"
    else
      state="clean"
    fi
  fi
  echo "$d|$state|\${ct:-0}|"
done
`;

function parseLine(sourceDir: string, line: string): ProjectStatus | null {
  const [name, status, lastCommit, error] = line.split("|");
  if (!name) return null;
  return {
    name,
    path: `${sourceDir}/${name}`,
    status: status as ReleaseStatus,
    lastCommit: Number(lastCommit) || 0,
    error: error || undefined,
  };
}

export function useWigl() {
  const [projects, setProjects] = useState<ProjectStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const sourceDir = await join(await homeDir(), SOURCE_DIR_RELATIVE_TO_HOME);
      const output = await Command.create("sh", ["-c", scanScript(sourceDir)]).execute();
      const lines = output.stdout.trim().split("\n").filter(Boolean);
      setProjects(lines.map((l) => parseLine(sourceDir, l)).filter((p): p is ProjectStatus => p !== null));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { projects, loading, refresh };
}

export function revealInFinder(path: string) {
  Command.create("open", ["-R", path]).execute();
}

// bundled VS Code CLI first (reuses an already-open window instead of
// spawning a new one), falls back to `open -a` if VS Code isn't installed there.
export async function openInEditor(path: string) {
  try {
    await Command.create("code", [path]).execute();
  } catch {
    try {
      await Command.create("open", ["-a", "Visual Studio Code", path]).execute();
    } catch {
      // no VS Code install found — nothing more we can do
    }
  }
}
