import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpToLine, GripVertical, ListPlus, Trash2 } from "lucide-react";
import { cn } from "@/wigl/utils";
import type { MusicApi } from "../useMusic";
import { Equalizer } from "./Equalizer";
import { Row, standardActions } from "./Row";

/** D2 + D4 — the queue is server-persistent; make losing it deliberate.
 * "Save" copies it to a new playlist (queue stays); "Clear" is two-step. */
const QueueHeader = ({ api, count }: { api: MusicApi; count: number }) => {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="flex items-center justify-between gap-2 px-2 pt-2 pb-1">
      <p className="music-tag shrink-0 text-muted-foreground/70">Up next · {count}</p>
      {saving ? (
        <form
          className="flex min-w-0 items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void api.saveQueueAsPlaylist(name);
            setName("");
            setSaving(false);
          }}
        >
          {/* biome-ignore lint/a11y/noAutofocus: opened by an explicit click */}
          <input
            data-no-drag
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`queue ${new Date().toISOString().slice(5, 16).replace("T", " ")}`}
            className="w-28 min-w-0 rounded border border-border bg-input/40 px-2 py-0.5 text-[10px] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          <button type="submit" data-no-drag className="text-[10px] text-muted-foreground hover:text-foreground">
            save
          </button>
        </form>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-no-drag
            onClick={() => setSaving(true)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <ListPlus className="size-3" /> Save
          </button>
          <button
            type="button"
            data-no-drag
            onClick={() => {
              if (confirmClear) {
                api.clearQueue();
                setConfirmClear(false);
              } else {
                setConfirmClear(true);
                setTimeout(() => setConfirmClear(false), 3000);
              }
            }}
            className="text-[10px] text-muted-foreground hover:text-destructive"
          >
            {confirmClear ? "clear queue?" : "Clear"}
          </button>
        </div>
      )}
    </div>
  );
};

const ROW_H = 42; // approx collapsed row height, for drag-target math

/** Up-next list with pointer drag-to-reorder. Optimistic while dragging;
 * `api.moveQueueItem` fires the MA command + keeps the optimistic order until
 * the next `queue_items_updated` reconciles it. */
export const QueueList = ({ api }: { api: MusicApi }) => {
  const list = api.upNext;
  const [drag, setDrag] = useState<{ id: string; from: number; to: number } | null>(null);
  const startY = useRef(0);

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-muted-foreground">
        <Equalizer bars={7} active={!!api.now?.playing} className="h-6 text-foreground/50" />
        <p className="text-[11px]">
          {api.now ? "Queue is empty — up next shows here." : "Nothing playing. Search above to start."}
        </p>
      </div>
    );
  }

  // While dragging, show the list with the dragged row moved to `to`.
  const view = (() => {
    if (!drag) return list;
    const copy = [...list];
    const [it] = copy.splice(drag.from, 1);
    copy.splice(drag.to, 0, it);
    return copy;
  })();

  const onDown = (id: string, from: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    setDrag({ id, from, to: from });
  };
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    setDrag((d) => {
      if (!d) return d;
      const shift = Math.round((e.clientY - startY.current) / ROW_H);
      const to = Math.max(0, Math.min(list.length - 1, d.from + shift));
      return to === d.to ? d : { ...d, to };
    });
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDrag((d) => {
      if (d && d.to !== d.from) api.moveQueueItem(d.id, d.to - d.from);
      return null;
    });
  };

  return (
    <>
      <QueueHeader api={api} count={list.length} />
      {view.map((it, i) => {
        const media = it.media_item ?? null;
        const asItem =
          media ?? ({ item_id: "", provider: "", name: it.name, uri: `queue:${it.queue_item_id}`, media_type: "track" as const });
        const extras = [
          {
            label: "Move to top",
            icon: <ArrowUpToLine className="size-3.5" />,
            run: () => api.moveQueueItem(it.queue_item_id, -i),
            hidden: i === 0,
          },
          {
            label: "Move to bottom",
            icon: <ArrowDownToLine className="size-3.5" />,
            run: () => api.moveQueueItemToEnd(it.queue_item_id),
            hidden: i === view.length - 1,
          },
          {
            label: "Remove from queue",
            icon: <Trash2 className="size-3.5" />,
            run: () => api.removeFromQueue(it.queue_item_id),
            danger: true,
          },
        ];
        return (
          <div
            key={it.queue_item_id}
            className={cn("transition-opacity", drag?.id === it.queue_item_id && "opacity-50")}
          >
            <Row
              item={asItem}
              api={api}
              index={i + 1}
              onPlay={media ? () => api.play(media, "play") : undefined}
              actions={media ? standardActions(api, media, extras) : extras}
              dragHandle={
                <button
                  type="button"
                  data-no-drag
                  aria-label="Drag to reorder"
                  onPointerDown={onDown(it.queue_item_id, i)}
                  onPointerMove={drag ? onMove : undefined}
                  onPointerUp={drag ? onUp : undefined}
                  className="-ml-1 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground/40 hover:text-foreground active:cursor-grabbing"
                >
                  <GripVertical className="size-3.5" />
                </button>
              }
            />
          </div>
        );
      })}
    </>
  );
};
