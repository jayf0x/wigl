// Shape shared with scripts/repos-scan.ts, which is the source of these
// fields — kept here (not there) so importing it doesn't pull scripts/ (bun
// runtime code, node types) into this project's `src`-only tsconfig.
export interface RepoScanRow {
  name: string;
  isGitRepo: boolean;
  hasNpmRelease: boolean; // package.json declares an "npm:deploy" script
  // only meaningful when hasNpmRelease: a tag exists AND there are open
  // changes or commits since it. No tag at all means "never released" —
  // that's not something to flag, so it's left false.
  npmUnreleased: boolean;
  lastCommit: number; // epoch seconds, 0 if unknown
  firstCommit: number; // epoch seconds of the repo's oldest commit, 0 if unknown
  lastRelease: number; // epoch seconds of the most recent tagged commit, 0 if never released
  hasUncommittedChanges: boolean; // `git status --porcelain` is non-empty
  error?: string;
}

export interface ProjectStatus extends RepoScanRow {
  path: string;
}

// One repo owned by the authenticated `gh` user — fetched from GitHub, not
// scanned off disk. Field names are already camelCase via the `gh api --jq`
// projection in commands.ts, so this doesn't mirror GitHub's REST shape.
export interface RemoteRepo {
  name: string;
  fullName: string;
  cloneUrl: string;
  private: boolean;
  updatedAt: string; // ISO 8601
}
