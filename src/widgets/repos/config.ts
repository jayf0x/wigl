// Adjust if your local projects live somewhere else.
export const SOURCE_DIR_RELATIVE_TO_HOME = "Documents/GitHub";

// wigl itself — this is a personal, always-run-from-checkout app, so the
// scan script is located relative to home rather than bundled as a resource.
export const REPO_ROOT_RELATIVE_TO_HOME = "Documents/GitHub/wigl";

export const POLL_INTERVAL_MS = 5 * 60 * 1000;

// gh-backed list of every repo the user owns — cached a week, persisted, per
// the task's "cache for 1 week" requirement (this is a much heavier call than
// the archived-names one above, since it pages through everything).
export const REMOTE_REPOS_STALE_MS = 7 * 24 * 60 * 60 * 1000;
