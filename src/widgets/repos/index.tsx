import { useState } from "react";
import { Activity, Clock, CloudDownload, FolderGit2, RefreshCw, Tag } from "lucide-react";
import { useReposWidget } from "./useReposWidget";
import { useRemoteRepos } from "./useRemoteRepos";
import { DEFAULT_SORT_DIR, sortProjects, type SortDir, type SortKey } from "./sort";
import { SortableHead } from "./cells";
import { Row } from "./Row";
import { remoteToRow } from "./remoteRow";
import { Settings } from "./Settings";
import { Widget, WidgetHeader, useStorage } from "@/wigl";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function ReposWidget() {
  const { projects, localNames, sourceDir, setSourceDirOverride, scanError, loading, refresh } = useReposWidget();
  const { repos: remoteRepos, loading: remoteLoading, refresh: refreshRemote } = useRemoteRepos();
  const [sortBy, setSortBy] = useStorage<SortKey>("repos_sort_by", "time");
  const [sortDir, setSortDir] = useStorage<SortDir>("repos_sort_dir", "desc");
  const [showUndownloaded, setShowUndownloaded] = useState(false);
  const [gitOnly, setGitOnly] = useStorage<boolean>("repos_git_only", true);

  function onSort(key: SortKey) {
    if (sortBy === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortBy(key);
      setSortDir(DEFAULT_SORT_DIR[key]);
    }
  }

  // Un-downloaded repos are reshaped into the same row type and merged into
  // the one sortable table rather than shown in a separate view — toggling
  // `showUndownloaded` only controls whether they're fetched/merged in, not
  // which columns or table are rendered. A repo that finishes cloning simply
  // stops being in `remoteRepos.filter(...)` (it's now in `projects`) and
  // reappears as a normal downloaded row on the next `refresh`, rather than
  // being spliced out of the list client-side.
  const localRows = gitOnly ? projects.filter((p) => p.isGitRepo) : projects;
  const undownloadedRows =
    showUndownloaded && sourceDir
      ? remoteRepos.filter((r) => !localNames.has(r.name)).map((r) => remoteToRow(r, `${sourceDir}/${r.name}`))
      : [];
  const sorted = sortProjects([...localRows, ...undownloadedRows], sortBy, sortDir);
  const hiddenByGitFilter = gitOnly && projects.length > localRows.length;

  const head = (
    <TableRow className="border-white/5 hover:bg-transparent">
      <SortableHead
        icon={Activity}
        title="status"
        sortKey="status"
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={onSort}
        className="w-px pr-0 pl-2"
      />
      <SortableHead label="name" sortKey="name" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
      <SortableHead
        icon={Clock}
        title="updated"
        sortKey="time"
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={onSort}
        className="w-px text-right"
      />
      <SortableHead
        icon={Tag}
        title="last release"
        sortKey="release"
        sortBy={sortBy}
        sortDir={sortDir}
        onSort={onSort}
        className="w-px text-right"
      />
      <TableHead className="h-7 w-px py-1 pr-1.5" />
    </TableRow>
  );

  return (
    <Widget w={6} h={5} col={0} row={0}>
      <WidgetHeader>
        <Button
          variant="ghost"
          size="icon-xs"
          title={gitOnly ? "showing git folders only — click to show all" : "showing all folders — click to show git only"}
          onClick={() => setGitOnly(!gitOnly)}
          className={cn("ml-auto opacity-50 hover:opacity-90", gitOnly && "text-cyan-400 opacity-90")}
        >
          <FolderGit2 className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title={showUndownloaded ? "show downloaded repos" : "show un-downloaded repos"}
          onClick={() => {
            setShowUndownloaded((v) => !v);
            if (!showUndownloaded) refreshRemote();
          }}
          className={cn("opacity-50 hover:opacity-90", showUndownloaded && "text-cyan-400 opacity-90")}
        >
          <CloudDownload className={`size-3 ${remoteLoading && showUndownloaded ? "animate-pulse" : ""}`} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title="refresh"
          onClick={() => {
            refresh();
            if (showUndownloaded) refreshRemote();
          }}
          className="opacity-50 hover:opacity-90"
        >
          <RefreshCw className={`size-3 ${loading || (showUndownloaded && remoteLoading) ? "animate-spin" : ""}`} />
        </Button>
        {sourceDir && <Settings sourceDir={sourceDir} onSave={setSourceDirOverride} />}
      </WidgetHeader>
      <div className="flex-1 overflow-y-auto">
        {!loading && sorted.length === 0 && (
          <div className={cn("px-3 py-2 text-[11px]", scanError ? "text-red-400/80" : "opacity-40")}>
            {scanError ?? (hiddenByGitFilter ? "no git repos found (non-git folders hidden)" : "no projects found")}
          </div>
        )}
        {sorted.length > 0 && (
          <Table className="text-[11.5px]">
            <TableHeader>{head}</TableHeader>
            <TableBody>
              {sorted.map((p) => (
                <Row
                  key={p.name}
                  p={p}
                  onChanged={refresh}
                  onCloned={() => {
                    refresh();
                    refreshRemote();
                  }}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </Widget>
  );
}

export default ReposWidget;
