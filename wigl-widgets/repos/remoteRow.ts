import type { ProjectStatus, RemoteRepo } from "./types";

// Reshapes a not-yet-cloned RemoteRepo into the same ProjectStatus shape the
// scanner produces, so Row/cells/sort.ts need no separate code path — just
// `downloaded: false` and the fields that genuinely have no local equivalent
// set to values that already read as "no data" in the existing components
// (hasNpmRelease: false hides the status dot, lastRelease: -1 sorts below
// "never released" locals and renders blank).
export const remoteToRow = (repo: RemoteRepo, destDir: string): ProjectStatus => {
  return {
    name: repo.name,
    path: destDir,
    isGitRepo: true,
    hasNpmRelease: false,
    npmUnreleased: false,
    lastCommit: Math.floor(new Date(repo.updatedAt).getTime() / 1000),
    firstCommit: 0,
    lastRelease: -1,
    hasUncommittedChanges: false,
    downloaded: false,
    remote: repo,
  };
};
