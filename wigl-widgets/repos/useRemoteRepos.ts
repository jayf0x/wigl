import { useQuery } from "@/wigl/hooks";
import { loadRemoteRepos } from "./commands";
import { REMOTE_REPOS_STALE_MS } from "./config";
import type { RemoteRepo } from "./types";

// Every repo the user owns on GitHub, gh-backed and cached a week (see
// config.ts) — this is the full remote list the "un-downloaded" view filters
// against, not just what's on disk.
export const useRemoteRepos = () => {
  const [repos, loading, { refresh }] = useQuery<RemoteRepo[]>({
    key: "repos_remote",
    fn: loadRemoteRepos,
    stale: REMOTE_REPOS_STALE_MS,
    useSql: true,
  });
  return { repos: repos ?? [], loading, refresh };
};
