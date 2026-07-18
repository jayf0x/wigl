// Default source dir, used until the user sets one via the widget's settings
// panel (Settings.tsx, persisted as "repos_source_dir" — see
// useReposWidget.ts). Per-machine paths belong in that override, not here.
export const SOURCE_DIR_RELATIVE_TO_HOME = "Documents/GitHub";

export const POLL_INTERVAL_MS = 5 * 60 * 1000;

// gh-backed list of every repo the user owns — cached a week, persisted, per
// the task's "cache for 1 week" requirement (this is a much heavier call than
// the archived-names one above, since it pages through everything).
export const REMOTE_REPOS_STALE_MS = 7 * 24 * 60 * 60 * 1000;
