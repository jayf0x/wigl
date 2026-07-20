import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Field, inputCls } from "./Field";
import type { Draft } from "./calendar.utils";

export function Sidebar({
  draft,
  setDraft,
  canSave,
  canDelete,
  onSave,
  onDelete,
  onNew,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  canSave: boolean;
  canDelete: boolean;
  onSave: () => void;
  onDelete: () => void;
  onNew: () => void;
}) {
  return (
    <div className="flex w-[150px] shrink-0 flex-col gap-1.5 border-l border-white/10 px-2.5 py-2 text-[10px]">
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="xs"
          className="h-5 w-5 p-0 opacity-60 hover:opacity-100"
          title="New event"
          onClick={onNew}
        >
          <Plus size={12} />
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="h-5 w-5 p-0 text-red-400/70 hover:text-red-400 disabled:opacity-20"
          title="Delete event"
          disabled={!canDelete}
          onClick={onDelete}
        >
          <Trash2 size={12} />
        </Button>
      </div>

      <Field label="title">
        <input
          value={draft.title}
          placeholder="Event title"
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className={inputCls}
        />
      </Field>
      <Field label="date">
        <input
          type="date"
          value={draft.date}
          onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          className={inputCls}
        />
      </Field>
      <Field label="time">
        <input
          type="time"
          value={draft.time}
          onChange={(e) => setDraft({ ...draft, time: e.target.value })}
          className={inputCls}
        />
      </Field>
      <Field label="notes">
        <textarea
          value={draft.description}
          rows={3}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          className={cn(inputCls, "resize-none")}
        />
      </Field>

      <Button
        variant="outline"
        size="xs"
        className="mt-auto h-6 w-full text-[10px]"
        disabled={!canSave}
        onClick={onSave}
      >
        save
      </Button>
    </div>
  );
}
