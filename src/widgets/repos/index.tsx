import { Activity, Clock, RefreshCw, Tag } from "lucide-react";
import { useReposWidget } from "./useReposWidget";
import { DEFAULT_SORT_DIR, sortProjects, type SortDir, type SortKey } from "./sort";
import { SortableHead } from "./cells";
import { Row } from "./Row";
import { Widget, WidgetHeader, useStorage } from "@/wigl";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

function ReposWidget() {
  const { projects, loading, refresh } = useReposWidget();
  const [sortBy, setSortBy] = useStorage<SortKey>("repos_sort_by", "time");
  const [sortDir, setSortDir] = useStorage<SortDir>("repos_sort_dir", "desc");

  function onSort(key: SortKey) {
    if (sortBy === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortBy(key);
      setSortDir(DEFAULT_SORT_DIR[key]);
    }
  }

  const sorted = sortProjects(projects, sortBy, sortDir);

  return (
    <Widget w={6} h={5} col={0} row={0}>
      <WidgetHeader>
        <Button
          variant="ghost"
          size="icon-xs"
          title="refresh"
          onClick={refresh}
          className="ml-auto opacity-50 hover:opacity-90"
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </WidgetHeader>
      <div className="flex-1 overflow-y-auto">
        {!loading && projects.length === 0 && (
          <div className="px-3 py-2 text-[11px] opacity-40">no projects found</div>
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
      </div>
    </Widget>
  );
}

export default ReposWidget;
