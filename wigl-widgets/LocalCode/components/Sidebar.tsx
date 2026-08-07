// Sessions rail. Collapses to zero width (not to an icon strip — an icon per
// session says nothing about which session it is), animating the width so the
// transcript reflows instead of jumping. The filter field only appears once
// there are enough sessions for filtering to mean anything.
import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/wigl/utils";
import type { SessionView } from "../useSessions";
import { SessionRow } from "./SessionRow";

const FILTER_THRESHOLD = 8;

export const Sidebar = ({
  sessions,
  activeID,
  open,
  onSelect,
  onCreate,
  onRename,
  onTogglePin,
  onDelete,
}: {
  sessions: SessionView[];
  activeID: string | null;
  open: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
}) => {
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  const visible = q ? sessions.filter((s) => s.displayTitle.toLowerCase().includes(q)) : sessions;

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col overflow-hidden border-border/60 transition-all duration-300 ease-out",
        open ? "w-52 border-r opacity-100" : "w-0 opacity-0",
      )}
    >
      <div className="flex w-52 shrink-0 items-center gap-1 px-2 pt-2 pb-1">
        {sessions.length >= FILTER_THRESHOLD ? (
          <div className="flex flex-1 items-center gap-1.5 rounded-md border border-transparent px-1.5 py-1 transition-colors duration-150 focus-within:border-border">
            <Search className="size-3 shrink-0 text-muted-foreground/50" />
            <input
              data-no-drag
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter"
              className="w-full bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/40"
            />
          </div>
        ) : (
          <span className="flex-1 px-1.5 text-[9.5px] tracking-[0.14em] text-muted-foreground/50 uppercase">
            sessions
          </span>
        )}
        <button
          type="button"
          data-no-drag
          title="new session"
          onClick={onCreate}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      <ScrollArea className="min-h-0 w-52 flex-1">
        <div className="flex flex-col gap-px px-1.5 pb-2">
          {visible.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              active={s.id === activeID}
              onSelect={() => onSelect(s.id)}
              onRename={(title) => onRename(s.id, title)}
              onTogglePin={() => onTogglePin(s.id)}
              onDelete={() => onDelete(s.id)}
            />
          ))}
          {visible.length === 0 && (
            <p className="px-2 py-6 text-center text-[10.5px] text-muted-foreground/40">
              {sessions.length ? "no match" : "no sessions yet"}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
