import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpToLine, Check, GripVertical, ListPlus, Trash2 } from "lucide-react";
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
  // feedback D — the Save button gave no sign it worked. After a successful
  // save, swap it for a checked "saved as <name>" that flashes, and lock it
  // out briefly so a double-tap can't make two playlists.
  const [saved, setSaved] = useState<string | null>(null);

  return (
    <div className="flex items-center justify-between gap-2 px-2 pt-2 pb-1">
      <p className="music-tag shrink-0 text-muted-foreground/70">Queue · {count}</p>
      {saved !== null ? (
        <span
          key="saved"
          className="mx-flash flex shrink-0 items-center gap-1 rounded px-1 text-[10px] text-muted-foreground"
        >
          <Check className="size-3" /> saved{saved ? ` as “${saved}”` : ""}
        </span>
      ) : saving ? (
        <form
          className="flex min-w-0 items-center gap-1"
          onSubmit={async (e) => {
            e.preventDefault();
            const label = name.trim();
            setName("");
            setSaving(false);
            const pl = await api.saveQueueAsPlaylist(label);
            const shown = pl?.name ?? label;
            setSaved(shown);
            setTimeout(() => setSaved(null), 2200);
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
          <button type="submit" data-no-drag className="mx-press text-[10px] text-muted-foreground hover:text-foreground">
            save
          </button>
        </form>
      ) : (
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-no-drag
            onClick={() => setSaving(true)}
            className="mx-press flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
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
            className="mx-press text-[10px] text-muted-foreground hover:text-destructive"
          >
            {confirmClear ? "clear queue?" : "Clear"}
          </button>
        </div>
      )}
    </div>
  );
};

const ROW_H_FALLBACK = 42; // used only until we measure a real row

/** The Queue tab list (the items after the current one) with pointer
 * drag-to-reorder (P0.5). The DOM row order never
 * changes during a drag — the dragged row and the rows it passes are moved
 * with CSS transforms only — so the pointer-captured handle stays put in the
 * tree and WebKit never drops capture mid-gesture. The list is frozen to a
 * snapshot for the duration of the drag so an incoming `refreshQueue` can't
 * yank it. One `moveQueueItem` fires on drop; nothing commits mid-gesture. */
export const QueueList = ({ api }: { api: MusicApi }) => {
  const live = api.upNext;
  const [drag, setDrag] = useState<{
    id: string;
    from: number;
    to: number;
    dy: number;
  } | null>(null);
  const startY = useRef(0);
  const rowH = useRef(ROW_H_FALLBACK);
  const frozen = useRef<typeof live>([]);
  if (!drag) frozen.current = live;
  const list = drag ? frozen.current : live;

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-muted-foreground">
        <Equalizer bars={7} active={!!api.now?.playing} className="h-6 text-foreground/50" />
        <p className="text-[11px]">
          {api.now
            ? "Queue is empty — tracks you play or add show up here."
            : "Nothing playing. Search above to start."}
        </p>
      </div>
    );
  }

  const onDown = (id: string, from: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    startY.current = e.clientY;
    const row = e.currentTarget.closest("[data-qrow]") as HTMLElement | null;
    if (row?.offsetHeight) rowH.current = row.offsetHeight;
    setDrag({ id, from, to: from, dy: 0 });
  };
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    setDrag((d) => {
      if (!d) return d;
      const dy = e.clientY - startY.current;
      const shift = Math.round(dy / rowH.current);
      const to = Math.max(0, Math.min(list.length - 1, d.from + shift));
      return { ...d, dy, to };
    });
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture already gone */
    }
    setDrag((d) => {
      if (d && d.to !== d.from) api.moveQueueItem(d.id, d.to - d.from);
      return null;
    });
  };

  /** Transform offset (px) for the row at DOM index `i` during a drag. */
  const rowShift = (i: number): number => {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.to > drag.from && i > drag.from && i <= drag.to) return -rowH.current;
    if (drag.to < drag.from && i < drag.from && i >= drag.to) return rowH.current;
    return 0;
  };

  return (
    <>
      <QueueHeader api={api} count={list.length} />
      {list.map((it, i) => {
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
            hidden: i === list.length - 1,
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
            data-qrow
            style={{
              transform: `translateY(${rowShift(i)}px)`,
              transition: drag?.id === it.queue_item_id ? "none" : "transform 140ms ease",
              position: "relative",
              zIndex: drag?.id === it.queue_item_id ? 2 : undefined,
            }}
            className={cn(drag?.id === it.queue_item_id && "opacity-70")}
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
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
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
