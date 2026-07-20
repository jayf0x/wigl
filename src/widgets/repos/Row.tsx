import { useState } from "react";
import { cn } from "@/wigl/utils";
import { Check, CloudDownload, Code2, FolderOpen, GitBranch, GitCommitHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { RelativeTime, StatusIcon, statusTitle } from "./cells";
import { cloneRepo, commitAllChanges, openInEditor, openInGithubDesktop, revealInFileManager } from "./commands";
import type { ProjectStatus } from "./types";

// git's --progress lines restart at 0% per phase (Counting/Compressing/
// Receiving/Resolving) — mapping each phase onto its own slice of the 0-99
// range (capped below 100 until the promise actually resolves) and never
// letting the value fall keeps the bar reading as continuous forward motion
// instead of resetting to 0 and then jumping straight to 100%.
const CLONE_PHASES: { match: RegExp; base: number; span: number }[] = [
  { match: /counting objects/i, base: 0, span: 10 },
  { match: /compressing objects/i, base: 10, span: 10 },
  { match: /receiving objects/i, base: 20, span: 60 },
  { match: /resolving deltas/i, base: 80, span: 15 },
  { match: /updating files/i, base: 95, span: 4 },
];

const nextClonePercent = (line: string, prev: number): number => {
  const pct = line.match(/(\d+)%/);
  if (!pct) return prev;
  const phase = CLONE_PHASES.find((p) => p.match.test(line));
  const mapped = phase ? phase.base + (Number(pct[1]) / 100) * phase.span : Number(pct[1]);
  return Math.max(prev, Math.min(99, Math.round(mapped)));
};

// `onChanged` is called after a successful commit, so the caller re-scans
// and this row's `hasUncommittedChanges` (and thus the commit icon) updates.
// `onCloned` fires after a successful clone — the caller re-scans local
// projects and the remote list, which turns this same row into a normal
// downloaded one on the next render rather than removing it.
export const Row = ({ p, onChanged, onCloned }: { p: ProjectStatus; onChanged: () => void; onCloned?: () => void }) => {
  const [committing, setCommitting] = useState(false);
  const [message, setMessage] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloned, setCloned] = useState(false);
  const [clonePercent, setClonePercent] = useState(0);
  const [cloneError, setCloneError] = useState<string | null>(null);

  const downloaded = p.downloaded !== false;

  const submitCommit = async () => {
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
  };

  const startClone = async () => {
    if (!p.remote || cloning || cloned) return;
    setCloneError(null);
    setClonePercent(0);
    setCloning(true);
    try {
      await cloneRepo(p.remote, p.path, (line) => setClonePercent((prev) => nextClonePercent(line, prev)));
      setClonePercent(100);
      setCloned(true);
      onCloned?.();
    } catch (err) {
      setCloning(false);
      setCloneError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <TableRow
      title={cloneError ?? statusTitle(p)}
      onClick={!downloaded ? startClone : undefined}
      className={cn(
        "group border-white/5",
        !downloaded && !cloned && !cloning && "cursor-pointer hover:bg-white/5",
        cloning && "cursor-default animate-pulse",
      )}
      style={
        !downloaded && clonePercent > 0
          ? {
              backgroundImage: `linear-gradient(to right, rgba(34,211,238,0.18) ${clonePercent}%, transparent ${clonePercent}%)`,
            }
          : undefined
      }
    >
      <TableCell className="w-px py-1 pr-0 pl-2">
        <StatusIcon p={p} />
      </TableCell>
      <TableCell
        className={cn(
          "overflow-hidden px-1.5 py-1 text-ellipsis whitespace-nowrap",
          !downloaded && "opacity-60",
          cloneError && "text-red-400/80",
        )}
      >
        {p.name}
      </TableCell>
      <TableCell className="w-px px-1.5 py-1 text-right text-[10px] opacity-35">
        <RelativeTime epochSeconds={p.lastCommit} />
      </TableCell>
      <TableCell
        className={cn("w-px px-1.5 py-1 text-right text-[10px]", p.lastRelease > 0 ? releaseScoreClass(p) : null)}
      >
        {p.lastRelease > 0 ? compactAge(p.lastRelease) : ""}
      </TableCell>
      <TableCell className="relative w-px py-1 pr-1.5">
        {downloaded ? (
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
            <Button
              variant="ghost"
              size="icon-xs"
              title="Reveal in file manager"
              onClick={() => revealInFileManager(p)}
            >
              <FolderOpen className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              title="Open in GitHub Desktop"
              onClick={() => openInGithubDesktop(p)}
            >
              <GitBranch className="size-3" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-0.5">
            <Button
              variant="ghost"
              size="icon-xs"
              title={cloned ? "downloaded" : cloneError ? "clone failed — click row to retry" : "clone"}
              disabled={cloning || cloned}
              onClick={startClone}
              className={cloned ? "text-emerald-400" : "opacity-70 hover:opacity-100"}
            >
              {cloned ? <Check className="size-3" /> : <CloudDownload className="size-3" />}
            </Button>
          </div>
        )}
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
const compactAge = (time: number): string => {
  const days = (Date.now() / 1000 - time) / 86400;
  if (days < 14) return `${Math.max(0, Math.round(days))}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
};

// Expected release cadence grows sub-linearly with project age — a smooth
// stand-in for "young projects ship often, mature ones settle down" instead
// of a fixed threshold like "2 weeks". null = never released.
const releaseScore = (p: ProjectStatus): number => {
  const now = Date.now() / 1000;
  const ageDays = Math.max(0, (now - p.firstCommit) / 86400);
  const daysSinceRelease = Math.max(0, (now - p.lastRelease) / 86400);
  const expectedDays = 3 + ageDays ** 0.6;
  return daysSinceRelease / expectedDays;
};

const releaseScoreClass = (p: ProjectStatus) => {
  if (!p.lastRelease) return null;
  const s = releaseScore(p);
  if (s >= 2) return "text-red-400/80";
  if (s < 0.5) return "text-emerald-400/80";
  if (s < 1) return "text-yellow-400/80";
  return "text-orange-400/80";
};
