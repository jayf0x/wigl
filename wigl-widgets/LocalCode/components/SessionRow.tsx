import { useState } from "react";
import { Pin, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.displayTitle);

  if (editing) {
    return (
      <Input
        data-no-drag
        autoFocus
        size="sm"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim()) onRename(draft.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(session.displayTitle);
            setEditing(false);
          }
        }}
        className="mx-1"
      />
    );
  }

  return (
    <button
      type="button"
      data-no-drag
      onClick={onSelect}
      onDoubleClick={() => setEditing(true)}
      className={cn(
        "group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px]",
        active ? "bg-primary/10" : "hover:bg-muted/60",
      )}
    >
      <button
        type="button"
        data-no-drag
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        title={session.pinned ? "unpin" : "pin to top"}
        className={cn("shrink-0 opacity-0 group-hover:opacity-60", session.pinned && "opacity-80")}
      >
        <Pin className={cn("size-3", session.pinned && "fill-current")} />
      </button>
      <span className="flex-1 truncate">{session.displayTitle}</span>
      <span className="shrink-0 opacity-40 group-hover:hidden">{relativeTime(session.time.updated / 1000)}</span>
      <button
        type="button"
        data-no-drag
        onClick={(e) => {
          e.stopPropagation();
          if (confirm(`Delete "${session.displayTitle}"? This can't be undone.`)) onDelete();
        }}
        title="delete session"
        className="hidden shrink-0 text-destructive/70 hover:text-destructive group-hover:block"
      >
        <Trash2 className="size-3" />
      </button>
    </button>
  );
};
