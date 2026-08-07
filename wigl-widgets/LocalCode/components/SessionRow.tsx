// One session. Double-click renames in place; pin and delete only surface on
// hover so the resting state is just a list of names. The active row is a
// left accent bar rather than a filled pill — same signal, far less noise in
// a list you're scanning.
import { useState } from "react";
import { Pin, Trash2 } from "lucide-react";
import { relativeTime, cn } from "@/wigl/utils";
import type { SessionView } from "../useSessions";

export const SessionRow = ({
  session,
  active,
  onSelect,
  onRename,
  onTogglePin,
  onDelete,
}: {
  session: SessionView;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) => {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft !== null) {
    return (
      <input
        data-no-drag
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim()) onRename(draft.trim());
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(null);
        }}
        className="w-full rounded-md border border-ring/50 bg-background/50 px-2 py-1.5 text-[11px] outline-none"
      />
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded-md border-l-2 px-2 py-1.5 text-[11px] transition-colors duration-150",
        active ? "border-primary bg-muted/50 text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground",
      )}
    >
      <button
        type="button"
        data-no-drag
        onClick={onSelect}
        onDoubleClick={() => setDraft(session.displayTitle)}
        className="min-w-0 flex-1 truncate text-left"
      >
        {session.displayTitle}
      </button>
      <span className="shrink-0 text-[10px] text-muted-foreground/40 group-hover:hidden">
        {relativeTime(session.time.updated / 1000)}
      </span>
      <button
        type="button"
        data-no-drag
        onClick={onTogglePin}
        title={session.pinned ? "unpin" : "pin to top"}
        className={cn(
          "hidden shrink-0 text-muted-foreground/60 hover:text-foreground group-hover:block",
          session.pinned && "block text-foreground/70",
        )}
      >
        <Pin className={cn("size-3", session.pinned && "fill-current")} />
      </button>
      <button
        type="button"
        data-no-drag
        onClick={() => {
          if (confirm(`Delete "${session.displayTitle}"? This can't be undone.`)) onDelete();
        }}
        title="delete session"
        className="hidden shrink-0 text-muted-foreground/60 hover:text-destructive group-hover:block"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
};
