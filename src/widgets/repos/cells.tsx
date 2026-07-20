import { useRelativeTime } from "@/wigl";
import { ChevronDown, ChevronUp, Circle, CloudDownload, type LucideIcon, TriangleAlert } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SortDir, SortKey } from "./sort";
import type { ProjectStatus } from "./types";

// npm release status, web3-flavored: nothing to show = invisible, pending
// changes = glowing cyan pulse, released & settled = dimmed violet.
export function StatusIcon({ p }: { p: ProjectStatus }) {
  if (p.downloaded === false) return <CloudDownload className="size-2.5 opacity-30" />;
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
  if (p.downloaded === false) return "not downloaded — click to clone";
  if (!p.isGitRepo) return p.error ?? "not a git repository";
  if (!p.hasNpmRelease) return "no npm:deploy script";
  if (p.npmUnreleased) return "unreleased changes since last npm release";
  return "up to date with last npm release";
}

export function RelativeTime({ epochSeconds }: { epochSeconds: number }) {
  return <>{useRelativeTime(epochSeconds)}</>;
}

// `label` is text (name column); `icon` + `title` swaps in an icon-only
// header with the word in a tooltip — keeps narrow columns narrow.
export function SortableHead({
  label,
  icon: Icon,
  title,
  sortKey,
  sortBy,
  sortDir,
  onSort,
  className,
}: {
  label?: string;
  icon?: LucideIcon;
  title?: string;
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
      title={title}
      onClick={() => onSort(sortKey)}
      className={cn(
        "h-7 cursor-pointer select-none whitespace-nowrap px-1.5 py-1 text-[10px] tracking-wide opacity-45 hover:opacity-80",
        active && "opacity-90",
        className,
      )}
    >
      <span className="inline-flex items-center gap-0.5">
        {Icon ? <Icon className="size-3" /> : label}
        {active && <Arrow className="size-2.5" />}
      </span>
    </TableHead>
  );
}
