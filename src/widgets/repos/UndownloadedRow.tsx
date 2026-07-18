import { useState } from "react";
import { Download, Loader2, TriangleAlert } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { cloneRepo } from "./commands";
import type { RemoteRepo } from "./types";

// A remote repo that isn't cloned locally yet. Clicking the row clones it in
// place, showing git's own `--progress` lines; once `cloneRepo` resolves the
// caller re-scans (`onCloned`), the repo picks up a local match, and this row
// simply stops being in the "un-downloaded" list on the next render — no
// local "done" state to track here.
export function UndownloadedRow({
  repo,
  destDir,
  onCloned,
}: {
  repo: RemoteRepo;
  destDir: string;
  onCloned: () => void;
}) {
  const [cloning, setCloning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function startClone() {
    if (cloning) return;
    setError(null);
    setCloning(true);
    try {
      await cloneRepo(repo, destDir, setProgress);
      onCloned();
    } catch (err) {
      setCloning(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <TableRow
      title={error ?? (repo.private ? "private" : undefined)}
      onClick={startClone}
      className={cn("group border-white/5", cloning ? "cursor-default" : "cursor-pointer hover:bg-white/5")}
    >
      <TableCell className="w-px py-1 pr-0 pl-2">
        {error ? (
          <TriangleAlert className="size-3 text-amber-400" />
        ) : cloning ? (
          <Loader2 className="size-3 animate-spin text-cyan-400" />
        ) : (
          <Download className="size-3 opacity-0 group-hover:opacity-60" />
        )}
      </TableCell>
      <TableCell className="overflow-hidden px-1.5 py-1 text-ellipsis whitespace-nowrap">{repo.name}</TableCell>
      <TableCell className="overflow-hidden px-1.5 py-1 text-right text-[10px] whitespace-nowrap opacity-40">
        {error ? <span className="text-red-400/80">{error}</span> : cloning ? progress || "cloning…" : ""}
      </TableCell>
    </TableRow>
  );
}
