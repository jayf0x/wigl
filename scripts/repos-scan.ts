// Repo scanner for the repos widget — walks one level of a source dir and
// reports git/npm-release status per project. Plain functions over `git`,
// not a shell one-liner, so it's runnable and debuggable on its own:
//
//   bun run repos:scan ~/Documents/GitHub
//
// The widget's hook (src/widgets/repos/useReposWidget.ts) shells out to this
// same file via `sh -c "bun <this file> <dir>"` and JSON.parses stdout.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { RepoScanRow } from "../src/widgets/repos/repos.types";

export type { RepoScanRow };

function git(dir: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function scanRepo(dir: string, name: string): RepoScanRow {
  if (!git(dir, ["rev-parse", "--is-inside-work-tree"])) {
    return {
      name,
      isGitRepo: false,
      hasNpmRelease: false,
      npmUnreleased: false,
      lastCommit: 0,
      firstCommit: 0,
      lastRelease: 0,
      error: "not a git repository",
    };
  }

  const lastCommit = Number(git(dir, ["log", "-1", "--format=%ct"])) || 0;
  const firstCommit = Number(git(dir, ["log", "--reverse", "--format=%ct"]).split("\n")[0]) || 0;
  const tag = git(dir, ["describe", "--tags", "--abbrev=0"]);
  const lastRelease = tag ? Number(git(dir, ["log", "-1", "--format=%ct", tag])) || 0 : 0;

  let hasNpmRelease = false;
  let npmUnreleased = false;
  if (existsSync(`${dir}/package.json`) && readFileSync(`${dir}/package.json`, "utf8").includes('"npm:deploy"')) {
    hasNpmRelease = true;
    if (tag) {
      const dirty = git(dir, ["status", "--porcelain"]);
      const ahead = Number(git(dir, ["rev-list", `${tag}..HEAD`, "--count"])) || 0;
      npmUnreleased = Boolean(dirty) || ahead !== 0;
    }
  }

  return { name, isGitRepo: true, hasNpmRelease, npmUnreleased, lastCommit, firstCommit, lastRelease };
}

export function scanSourceDir(sourceDir: string): RepoScanRow[] {
  if (!existsSync(sourceDir)) return [];
  return readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => scanRepo(`${sourceDir}/${entry.name}`, entry.name));
}

if (import.meta.main) {
  const sourceDir = process.argv[2];
  if (!sourceDir) {
    console.error("Usage: bun run repos:scan <sourceDir>");
    process.exit(1);
  }
  console.log(JSON.stringify(scanSourceDir(sourceDir)));
}
