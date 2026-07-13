import { ChevronDown, ChevronUp, Circle, TriangleAlert } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { useRelativeTime } from "@/wigl";
import { cn } from "@/lib/utils";
import type { ProjectStatus } from "./useReposWidget";
import type { SortDir, SortKey } from "./repos.sort";

// npm release status, web3-flavored: nothing to show = invisible, pending
// changes = glowing cyan pulse, released & settled = dimmed violet.
export function StatusIcon({ p }: { p: ProjectStatus }) {
  if (!p.isGitRepo) return <TriangleAlert className="size-3 text-amber-400" />;
  if (!p.hasNpmRelease) return <Circle className="size-2.5 opacity-0" />;
  if (p.npmUnreleased) {
    return (
      <span className="relative flex size-2.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan-400 opacity-75" />
        <Circle className="relative size-2.5 fill-cyan-400 text-cyan-400 drop-shadow-[0_0_5px_rgba(34,211,238,0.85)]" />
      </span>
    );
  }
  return <Circle className="size-2.5 fill-violet-400/45 text-violet-400/45" />;
}

export function statusTitle(p: ProjectStatus) {
  if (!p.isGitRepo) return p.error ?? "not a git repository";
  if (!p.hasNpmRelease) return "no npm:deploy script";
  if (p.npmUnreleased) return "unreleased changes since last npm release";
  return "up to date with last npm release";
}

export function RelativeTime({ epochSeconds }: { epochSeconds: number }) {
  return <>{useRelativeTime(epochSeconds)}</>;
}

export function SortableHead({
  label,
  sortKey,
  sortBy,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sortBy: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sortBy === sortKey;
  const Arrow = sortDir === "asc" ? ChevronUp : ChevronDown;
  return (
    <TableHead
      onClick={() => onSort(sortKey)}
      className={cn(
        "h-7 cursor-pointer select-none whitespace-nowrap py-1 text-[10px] tracking-wide opacity-45 hover:opacity-80",
        active && "opacity-90",
        className,
      )}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active && <Arrow className="size-2.5" />}
      </span>
    </TableHead>
  );
}
