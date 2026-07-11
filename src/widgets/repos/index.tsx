import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDownAZ, Circle, Clock, Code2, FolderOpen, GitBranch, RefreshCw, TriangleAlert } from "lucide-react";
import {
  ProjectStatus,
  openInEditor,
  openInGithubDesktop,
  revealInFinder,
  useReposWidget,
} from "./useReposWidget";
import { Widget, WidgetHeader, type WidgetWindowConfig } from "@/wigl";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";

type SortKey = "name" | "status" | "time";

// lower = more urgent, surfaced first when sorting by status
function statusRank(p: ProjectStatus) {
  if (!p.isGitRepo) return 1;
  if (p.npmUnreleased) return 0;
  return 2;
}

const SORTERS: Record<SortKey, (a: ProjectStatus, b: ProjectStatus) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  status: (a, b) => statusRank(a) - statusRank(b),
  time: (a, b) => b.lastCommit - a.lastCommit,
};

const SORT_ACTIONS: { key: SortKey; icon: LucideIcon; title: string }[] = [
  { key: "name", icon: ArrowDownAZ, title: "sort: name" },
  { key: "status", icon: Circle, title: "sort: npm release status" },
  { key: "time", icon: Clock, title: "sort: last updated" },
];

// npm release status: dim = no npm:deploy script, green = released & clean
// (or never released — nothing to flag), amber-red = changes since last tag.
function StatusIcon({ p }: { p: ProjectStatus }) {
  if (!p.isGitRepo) return <TriangleAlert className="size-3 text-amber-400" />;
  if (!p.hasNpmRelease) return <Circle className="size-2.5 fill-white/25 text-white/25" />;
  if (p.npmUnreleased) return <Circle className="size-2.5 fill-red-400 text-red-400" />;
  return <Circle className="size-2.5 fill-emerald-400 text-emerald-400" />;
}

function statusTitle(p: ProjectStatus) {
  if (!p.isGitRepo) return p.error ?? "not a git repository";
  if (!p.hasNpmRelease) return "no npm:deploy script";
  if (p.npmUnreleased) return "unreleased changes since last npm release";
  return "up to date with last npm release";
}

function relTime(epochSeconds: number) {
  if (!epochSeconds) return "?";
  const diff = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 604800)}w`;
}

export const windowConfig: WidgetWindowConfig = {
  width: 340,
  height: 400,
  x: 40,
  y: 40,
};

export default function ReposWidget() {
  const { projects, loading, refresh } = useReposWidget();
  const [sortBy, setSortBy] = useState<SortKey>("time");
  const sorted = [...projects].sort(SORTERS[sortBy]);

  return (
    <Widget>
      <WidgetHeader>
        <span className="px-1 text-[10px] tracking-widest opacity-40">REPOS</span>
        <div className="ml-auto flex items-center gap-0.5">
          {SORT_ACTIONS.map(({ key, icon: Icon, title }) => (
            <Button
              key={key}
              variant="ghost"
              size="icon-xs"
              title={title}
              onClick={() => setSortBy(key)}
              className={sortBy === key ? "opacity-90" : "opacity-35 hover:opacity-80"}
            >
              <Icon className="size-3" />
            </Button>
          ))}
          <Button
            variant="ghost"
            size="icon-xs"
            title="refresh"
            onClick={refresh}
            className="opacity-50 hover:opacity-90"
          >
            <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </WidgetHeader>
      <div className="flex-1 overflow-y-auto">
        {!loading && projects.length === 0 && (
          <div className="px-3 py-2 text-[11px] opacity-40">no projects found</div>
        )}
        {sorted.length > 0 && (
          <Table className="text-[11.5px]">
            <TableBody>
              {sorted.map((p) => (
                <TableRow key={p.name} title={statusTitle(p)} className="group border-white/5">
                  <TableCell className="w-px py-1.5 pr-0 pl-2.5">
                    <StatusIcon p={p} />
                  </TableCell>
                  <TableCell className="overflow-hidden text-ellipsis whitespace-nowrap py-1.5">
                    {p.name}
                  </TableCell>
                  <TableCell className="w-px py-1.5 text-right text-[10px] opacity-35">
                    {relTime(p.lastCommit)}
                  </TableCell>
                  <TableCell className="w-px py-1 pr-1.5">
                    <div className="flex items-center gap-0.5 opacity-40 group-hover:opacity-90">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Open in VS Code"
                        onClick={() => openInEditor(p.path)}
                      >
                        <Code2 className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Reveal in Finder"
                        onClick={() => revealInFinder(p.path)}
                      >
                        <FolderOpen className="size-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Open in GitHub Desktop"
                        onClick={() => openInGithubDesktop(p.path)}
                      >
                        <GitBranch className="size-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </Widget>
  );
}
