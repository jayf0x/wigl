import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SessionView } from "../useSessions";
import { SessionRow } from "./SessionRow";

export const Sidebar = ({
  sessions,
  activeID,
  onSelect,
  onCreate,
  onRename,
  onTogglePin,
}: {
  sessions: SessionView[];
  activeID: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
}) => {
  const [filter, setFilter] = useState("");
  const visible = filter.trim()
    ? sessions.filter((s) => s.displayTitle.toLowerCase().includes(filter.trim().toLowerCase()))
    : sessions;

  return (
    <div className="flex w-44 shrink-0 flex-col border-border/60 border-r">
      <div className="flex items-center gap-1 px-1.5 py-1.5">
        <Input
          data-no-drag
          size="sm"
          placeholder="filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1"
        />
        <Button size="icon-xs" variant="ghost" title="new session" onClick={onCreate}>
          <Plus className="size-3.5" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-0.5 px-1 pb-1">
          {visible.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              active={s.id === activeID}
              onSelect={() => onSelect(s.id)}
              onRename={(title) => onRename(s.id, title)}
              onTogglePin={() => onTogglePin(s.id)}
            />
          ))}
          {visible.length === 0 && <p className="px-2 py-4 text-center text-[10.5px] opacity-40">no sessions</p>}
        </div>
      </ScrollArea>
    </div>
  );
};
