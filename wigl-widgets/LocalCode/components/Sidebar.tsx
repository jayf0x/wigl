// Sessions rail — the shared <Sidebar> frame plus LocalCode's own rows: a
// pin toggle beside the shared rename/delete.
import { Pin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sidebar as Rail, SidebarAction, SidebarItem } from "@/wigl";
import { cn, relativeTime } from "@/wigl/utils";
import type { SessionView } from "../hooks/useSessions";

export const Sidebar = ({
  sessions,
  activeID,
  open,
  loading,
  onSelect,
  onCreate,
  onRename,
  onTogglePin,
  onDelete,
}: {
  sessions: SessionView[];
  activeID: string | null;
  open: boolean;
  loading: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void | Promise<void>;
}) => (
  <Rail
    open={open}
    className="[--sb-w:13rem]"
    header={
      <div className="flex items-center gap-1 px-2 pt-2 pb-1">
        <span className="flex-1 px-1.5 text-[9.5px] tracking-[0.14em] text-muted-foreground/50 uppercase">
          sessions
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          data-no-drag
          title="new session"
          onClick={onCreate}
          className="shrink-0 rounded-md text-muted-foreground"
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
    }
  >
    {loading && sessions.length === 0 ? (
      Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-1.5 px-2 py-1.5">
          <div className="h-3 animate-pulse rounded bg-muted-foreground/15" style={{ width: `${70 - i * 8}%` }} />
        </div>
      ))
    ) : (
      <>
        {sessions.map((s) => (
          <SidebarItem
            key={s.id}
            title={s.displayTitle}
            meta={relativeTime(s.time.updated / 1000)}
            active={s.id === activeID}
            confirmText="delete this session?"
            onSelect={() => onSelect(s.id)}
            onRename={(title) => onRename(s.id, title)}
            onDelete={() => onDelete(s.id)}
            actions={
              <SidebarAction
                icon={Pin}
                title={s.pinned ? "unpin" : "pin to top"}
                onClick={() => onTogglePin(s.id)}
                className={cn(s.pinned && "block text-foreground/70 [&_svg]:fill-current")}
              />
            }
          />
        ))}
        {sessions.length === 0 && (
          <p className="px-2 py-6 text-center text-[10.5px] text-muted-foreground/40">no sessions yet</p>
        )}
      </>
    )}
  </Rail>
);
