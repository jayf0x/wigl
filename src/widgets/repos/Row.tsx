import { useState } from "react";
import { Code2, FolderOpen, GitBranch, GitCommitHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { commitAllChanges, openInEditor, openInGithubDesktop, revealInFileManager } from "./commands";
import { RelativeTime, StatusIcon, statusTitle } from "./cells";
import { ProjectStatus } from "./types";

// `onChanged` is called after a successful commit, so the caller re-scans
// and this row's `hasUncommittedChanges` (and thus the commit icon) updates.
export const Row = ({ p, onChanged }: { p: ProjectStatus; onChanged: () => void }) => {
  const [committing, setCommitting] = useState(false);
  const [message, setMessage] = useState("");

  async function submitCommit() {
    const trimmed = message.trim();
    if (!trimmed) return;
    try {
      await commitAllChanges(p, trimmed);
      setMessage("");
      setCommitting(false);
      onChanged();
    } catch (err) {
      // leave the box open with what they typed — a failing pre-commit hook
      // shouldn't silently eat the message.
      console.error(err);
    }
  }

  return (
    <TableRow title={statusTitle(p)} className="group border-white/5">
      <TableCell className="w-px py-1 pr-0 pl-2">
        <StatusIcon p={p} />
      </TableCell>
      <TableCell className="overflow-hidden px-1.5 py-1 text-ellipsis whitespace-nowrap">{p.name}</TableCell>
      <TableCell className="w-px px-1.5 py-1 text-right text-[10px] opacity-35">
        <RelativeTime epochSeconds={p.lastCommit} />
      </TableCell>
      <TableCell
        className={cn("w-px px-1.5 py-1 text-right text-[10px]", p.lastRelease ? releaseScoreClass(p) : null)}
      >
        {p.lastRelease ? compactAge(p.lastRelease) : ""}
      </TableCell>
      <TableCell className="relative w-px py-1 pr-1.5">
        <div className="flex items-center gap-0.5 opacity-40 group-hover:opacity-90">
          <Button
            variant="ghost"
            size="icon-xs"
            title={p.hasUncommittedChanges ? "Commit changes" : "Nothing to commit"}
            disabled={!p.hasUncommittedChanges}
            onClick={() => setCommitting(true)}
          >
            <GitCommitHorizontal className={cn("size-3", p.hasUncommittedChanges && "text-cyan-400")} />
          </Button>
          <Button variant="ghost" size="icon-xs" title="Open in VS Code" onClick={() => openInEditor(p)}>
            <Code2 className="size-3" />
          </Button>
          <Button variant="ghost" size="icon-xs" title="Reveal in file manager" onClick={() => revealInFileManager(p)}>
            <FolderOpen className="size-3" />
          </Button>
          <Button variant="ghost" size="icon-xs" title="Open in GitHub Desktop" onClick={() => openInGithubDesktop(p)}>
            <GitBranch className="size-3" />
          </Button>
        </div>
        {committing && (
          <input
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCommit();
              if (e.key === "Escape") {
                setCommitting(false);
                setMessage("");
              }
            }}
            onBlur={() => {
              setCommitting(false);
              setMessage("");
            }}
            placeholder="commit message, Enter to commit"
            className="absolute inset-y-0.5 right-0 z-10 w-44 rounded border border-white/10 bg-neutral-900 px-1.5 text-[10.5px] outline-none"
          />
        )}
      </TableCell>
    </TableRow>
  );
};

// Compact day/week/month/year label — release cadence is measured in days,
// not minutes, so this doesn't need the live-ticking useRelativeTime hook.
function compactAge(time: number): string {
  const days = (Date.now() / 1000 - time) / 86400;
  if (days < 14) return `${Math.max(0, Math.round(days))}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

// Expected release cadence grows sub-linearly with project age — a smooth
// stand-in for "young projects ship often, mature ones settle down" instead
// of a fixed threshold like "2 weeks". null = never released.
function releaseScore(p: ProjectStatus): number {
  const now = Date.now() / 1000;
  const ageDays = Math.max(0, (now - p.firstCommit) / 86400);
  const daysSinceRelease = Math.max(0, (now - p.lastRelease) / 86400);
  const expectedDays = 3 + ageDays ** 0.6;
  return daysSinceRelease / expectedDays;
}

function releaseScoreClass(p: ProjectStatus) {
  if (!p.lastRelease) return null;
  const s = releaseScore(p);
  if (s >= 2) return "text-red-400/80";
  if (s < 0.5) return "text-emerald-400/80";
  if (s < 1) return "text-yellow-400/80";
  return "text-orange-400/80";
}
