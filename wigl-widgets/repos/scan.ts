import { runCmd } from "@/wigl/utils";
import type { RepoScanRow } from "./types";

// Walks one level of a source dir and reports git/npm-release status per
// project, entirely in POSIX `sh` — no bundled script, no `bun` on PATH
// required. This used to shell out to `scripts/repos-scan.ts` via a
// resolved Tauri app-resource path, which a plugin can't do (see
// docs/widgets.md's host module registry: no raw `@tauri-apps/*` access).
// Rewriting the scan itself as a shell script removes the need for that
// capability altogether, rather than adding one just to keep the old shape.
// Output is NDJSON (one `{...}` object per line) — same convention as
// `commands.ts`'s `gh`-backed calls — so a partial/interrupted scan still
// parses whatever lines it managed to print.
const SCAN_SCRIPT = `
SRC="$1"
[ -d "$SRC" ] || exit 0
for d in "$SRC"/*/; do
  [ -d "$d" ] || continue
  name="$(basename "$d")"
  esc_name="$(printf '%s' "$name" | sed 's/"/\\"/g')"
  if git -C "$d" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    lastCommit="$(git -C "$d" log -1 --format=%ct 2>/dev/null)"
    [ -z "$lastCommit" ] && lastCommit=0
    firstCommit="$(git -C "$d" log --reverse --format=%ct 2>/dev/null | head -1)"
    [ -z "$firstCommit" ] && firstCommit=0
    tag="$(git -C "$d" describe --tags --abbrev=0 2>/dev/null)"
    lastRelease=0
    ahead=0
    if [ -n "$tag" ]; then
      lastRelease="$(git -C "$d" log -1 --format=%ct "$tag" 2>/dev/null)"
      [ -z "$lastRelease" ] && lastRelease=0
      ahead="$(git -C "$d" rev-list "$tag"..HEAD --count 2>/dev/null)"
      [ -z "$ahead" ] && ahead=0
    fi
    uncommitted=false
    [ -n "$(git -C "$d" status --porcelain 2>/dev/null)" ] && uncommitted=true
    hasnpm=false
    if [ -f "$d/package.json" ] && grep -q '"npm:deploy"' "$d/package.json" 2>/dev/null; then hasnpm=true; fi
    npmunrel=false
    if [ "$hasnpm" = true ] && [ -n "$tag" ]; then
      if [ "$uncommitted" = true ] || [ "$ahead" != "0" ]; then npmunrel=true; fi
    fi
    printf '{"name":"%s","isGitRepo":true,"hasNpmRelease":%s,"npmUnreleased":%s,"lastCommit":%s,"firstCommit":%s,"lastRelease":%s,"hasUncommittedChanges":%s}\\n' "$esc_name" "$hasnpm" "$npmunrel" "$lastCommit" "$firstCommit" "$lastRelease" "$uncommitted"
  else
    printf '{"name":"%s","isGitRepo":false,"hasNpmRelease":false,"npmUnreleased":false,"lastCommit":0,"firstCommit":0,"lastRelease":0,"hasUncommittedChanges":false,"error":"not a git repository"}\\n' "$esc_name"
  fi
done
`;

// `sourceDir` travels as `$1` (via the extra `sh -c` arg), not interpolated
// into the script text — same reasoning as everywhere else in this widget
// that touches a user-editable path.
export const scanSourceDir = async (sourceDir: string): Promise<RepoScanRow[]> => {
  const out = await runCmd("sh", ["-c", SCAN_SCRIPT, "repos-scan", sourceDir]);
  if (out.code !== 0) throw new Error(out.stderr || `scan failed: exit code ${out.code}`);
  return out.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RepoScanRow);
};
