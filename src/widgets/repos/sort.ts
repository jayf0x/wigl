import type { ProjectStatus } from "./types";

export type SortKey = "status" | "name" | "time" | "release";
export type SortDir = "asc" | "desc";

// lower = more urgent, surfaced first when sorting by status
function statusRank(p: ProjectStatus) {
  if (!p.isGitRepo) return 1;
  if (p.npmUnreleased) return 0;
  return 2;
}

export const SORTERS: Record<SortKey, (a: ProjectStatus, b: ProjectStatus) => number> = {
  status: (a, b) => statusRank(a) - statusRank(b),
  name: (a, b) => a.name.localeCompare(b.name),
  time: (a, b) => a.lastCommit - b.lastCommit,
  // never-released (0) sorts as "oldest" on either end — nothing to release recently.
  release: (a, b) => a.lastRelease - b.lastRelease,
};

// direction a column starts at the first time it's clicked
export const DEFAULT_SORT_DIR: Record<SortKey, SortDir> = {
  status: "asc",
  name: "asc",
  time: "desc",
  release: "desc",
};

export function sortProjects(projects: ProjectStatus[], sortBy: SortKey, sortDir: SortDir): ProjectStatus[] {
  return [...projects].sort((a, b) => {
    const cmp = SORTERS[sortBy](a, b);
    return sortDir === "asc" ? cmp : -cmp;
  });
}
