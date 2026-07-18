import { useState } from "react";
import { Activity, Clock, CloudDownload, RefreshCw, Tag } from "lucide-react";
import { useReposWidget } from "./useReposWidget";
import { useRemoteRepos } from "./useRemoteRepos";
import { DEFAULT_SORT_DIR, sortProjects, type SortDir, type SortKey } from "./sort";
import { SortableHead } from "./cells";
import { Row } from "./Row";
import { UndownloadedRow } from "./UndownloadedRow";
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

  function onSort(key: SortKey) {
    if (sortBy === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortBy(key);
      setSortDir(DEFAULT_SORT_DIR[key]);
    }
  }

  const sorted = sortProjects(projects, sortBy, sortDir);
  const undownloaded = remoteRepos
    .filter((r) => !localNames.has(r.name))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <Widget w={6} h={5} col={0} row={0}>
      <WidgetHeader>
        <Button
          variant="ghost"
          size="icon-xs"
          title={showUndownloaded ? "show downloaded repos" : "show un-downloaded repos"}
          onClick={() => {
            setShowUndownloaded((v) => !v);
            if (!showUndownloaded) refreshRemote();
          }}
          className={cn("ml-auto opacity-50 hover:opacity-90", showUndownloaded && "text-cyan-400 opacity-90")}
        >
          <CloudDownload className={`size-3 ${remoteLoading && showUndownloaded ? "animate-pulse" : ""}`} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title="refresh"
          onClick={showUndownloaded ? refreshRemote : refresh}
          className="opacity-50 hover:opacity-90"
        >
          <RefreshCw className={`size-3 ${(showUndownloaded ? remoteLoading : loading) ? "animate-spin" : ""}`} />
        </Button>
        {sourceDir && <Settings sourceDir={sourceDir} onSave={setSourceDirOverride} />}
      </WidgetHeader>
      <div className="flex-1 overflow-y-auto">
        {showUndownloaded ? (
          <>
            {!remoteLoading && undownloaded.length === 0 && (
              <div className="px-3 py-2 text-[11px] opacity-40">everything's downloaded</div>
            )}
            {undownloaded.length > 0 && sourceDir && (
              <Table className="text-[11.5px]">
                <TableHeader>
                  <TableRow className="border-white/5 hover:bg-transparent">
                    <TableHead className="h-7 w-px py-1 pr-0 pl-2" />
                    <TableHead className="h-7 py-1 text-[10px] tracking-wide opacity-45">name</TableHead>
                    <TableHead className="h-7 py-1 text-right text-[10px] tracking-wide opacity-45">status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {undownloaded.map((r) => (
                    <UndownloadedRow
                      key={r.name}
                      repo={r}
                      destDir={`${sourceDir}/${r.name}`}
                      onCloned={() => {
                        refresh();
                        refreshRemote();
                      }}
                    />
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        ) : (
          <>
            {!loading && projects.length === 0 && (
              <div className={cn("px-3 py-2 text-[11px]", scanError ? "text-red-400/80" : "opacity-40")}>
                {scanError ?? "no projects found"}
              </div>
            )}
            {sorted.length > 0 && (
              <Table className="text-[11.5px]">
                <TableHeader>
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
                </TableHeader>
                <TableBody>
                  {sorted.map((p) => (
                    <Row key={p.name} p={p} onChanged={refresh} />
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </div>
    </Widget>
  );
}

export default ReposWidget;
