import { useCallback, useEffect, useState } from "react";
import { Command } from "@tauri-apps/plugin-shell";
import { homeDir, join } from "@tauri-apps/api/path";
import { POLL_INTERVAL_MS, SOURCE_DIR_RELATIVE_TO_HOME } from "./reposWidget.config";

export interface ProjectStatus {
  name: string;
  path: string;
  isGitRepo: boolean;
  hasNpmRelease: boolean; // package.json declares an "npm:deploy" script
  // only meaningful when hasNpmRelease: a tag exists AND there are open
  // changes or commits since it. No tag at all means "never released" —
  // that's not something to flag, so it's left false.
  npmUnreleased: boolean;
  lastCommit: number; // epoch seconds, 0 if unknown
  error?: string;
}

// One shell round-trip per poll: scan SOURCE_DIR one level deep, and for each
// directory decide git-validity and npm release freshness.
const scanScript = (sourceDir: string) => `
cd "${sourceDir}" 2>/dev/null || exit 0
for d in */; do
  d="\${d%/}"
  if ! git -C "$d" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "$d|0|0|0|0|not a git repository"
    continue
  fi
  ct=$(git -C "$d" log -1 --format=%ct 2>/dev/null)
  hasNpm="0"
  unreleased="0"
  if grep -q '"npm:deploy"' "$d/package.json" 2>/dev/null; then
    hasNpm="1"
    tag=$(git -C "$d" describe --tags --abbrev=0 2>/dev/null)
    if [ -n "$tag" ]; then
      dirty=$(git -C "$d" status --porcelain 2>/dev/null)
      ahead=$(git -C "$d" rev-list "$tag"..HEAD --count 2>/dev/null)
      if [ -n "$dirty" ] || [ "\${ahead:-0}" != "0" ]; then
        unreleased="1"
      fi
    fi
  fi
  echo "$d|1|$hasNpm|$unreleased|\${ct:-0}|"
done
`;

function parseLine(sourceDir: string, line: string): ProjectStatus | null {
  const [name, isGitRepo, hasNpmRelease, npmUnreleased, lastCommit, error] = line.split("|");
  if (!name) return null;
  return {
    name,
    path: `${sourceDir}/${name}`,
    isGitRepo: isGitRepo === "1",
    hasNpmRelease: hasNpmRelease === "1",
    npmUnreleased: npmUnreleased === "1",
    lastCommit: Number(lastCommit) || 0,
    error: error || undefined,
  };
}

export function useReposWidget() {
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

// Every binary here runs through `sh -c`, per capabilities: only `sh` and
// `sqlite3` are registered under shell:allow-execute (see backlog's
// "Capabilities posture" decision) — one real boundary instead of a
// decorative per-binary allowlist. Quote args ourselves since sh -c takes a
// single string.
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
async function run(cmd: string) {
  const out = await Command.create("sh", ["-c", cmd]).execute();
  if (out.code !== 0) throw new Error(out.stderr || `command failed: ${cmd}`);
}

export function revealInFinder(path: string) {
  run(`open -R ${shQuote(path)}`).catch(console.error);
}

// bundled VS Code CLI first (reuses an already-open window instead of
// spawning a new one), falls back to `open -a` if VS Code isn't installed there.
// Absolute path, not bare `code` — GUI-launched shells often lack the PATH
// entry `code`'s "Shell Command: Install" step adds.
const VSCODE_CLI = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
export async function openInEditor(path: string) {
  try {
    await run(`${shQuote(VSCODE_CLI)} ${shQuote(path)}`);
  } catch {
    try {
      await run(`open -a "Visual Studio Code" ${shQuote(path)}`);
    } catch {
      // no VS Code install found — nothing more we can do
    }
  }
}

// "Install Command Line Tool" from GitHub Desktop's menu drops a `github`
// wrapper at /usr/local/bin — reuses an already-open window like `code` does.
// Falls back to the x-github-client:// URL scheme it always registers.
export async function openInGithubDesktop(path: string) {
  try {
    await run(`${shQuote("/usr/local/bin/github")} ${shQuote(path)}`);
  } catch {
    try {
      await run(`open ${shQuote(`x-github-client://openLocalRepo/${encodeURIComponent(path)}`)}`);
    } catch {
      // GitHub Desktop isn't installed — nothing more we can do
    }
  }
}
