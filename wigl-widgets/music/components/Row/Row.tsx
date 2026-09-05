import { type ReactNode, useEffect, useRef, useState } from "react";
import { Disc3, ListPlus, Music2, Radio, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/wigl/utils";
import { playlistDisplayImage } from "../../playlistImage";
import type { MediaItem } from "../../types";
import type { MusicApi } from "../../useMusic";
import { RowActionButtons } from "./RowActionButtons";
import { RowActionPanel } from "./RowActionPanel";
import { INLINE_ACTION_LABELS, type RowAction, standardActions } from "./standardActions";

const iconFor = (t: MediaItem["media_type"]) => {
  if (t === "radio") return <Radio className="size-3.5" />;
  if (t === "artist") return <User className="size-3.5" />;
  if (t === "album") return <Disc3 className="size-3.5" />;
  if (t === "playlist") return <ListPlus className="size-3.5" />;
  return <Music2 className="size-3.5" />;
};

const subtitleFor = (it: MediaItem): string => {
  if (it.media_type === "radio") return "Radio";
  if (it.media_type === "artist") return "Artist";
  if (it.media_type === "album") return it.artists?.map((a) => a.name).join(", ") || "Album";
  if (it.media_type === "playlist") return "Playlist";
  return it.artists?.map((a) => a.name).join(", ") || it.album?.name || it.media_type;
};

/** Row width (px) at/above which the inline shortcuts get shown. Mirrors the
 * old `@container (min-width: 15rem)` rule, but measured in JS so the `⋯`
 * panel can exclude exactly what's inline. */
const INLINE_MIN_PX = 232;

export const Row = ({
  item,
  api,
  index,
  actions,
  onPlay,
  dragHandle,
}: {
  item: MediaItem;
  api: MusicApi;
  /** shown as a left-hand number when provided (queue / album track lists) */
  index?: number;
  /** override the action set; defaults to `standardActions(api, item)` */
  actions?: RowAction[];
  /** override the left-click; defaults to non-destructive play-now */
  onPlay?: () => void;
  /** a drag grip rendered at the row's leading edge (queue reorder) */
  dragHandle?: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWide(e.contentRect.width >= INLINE_MIN_PX));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rawArt = api.imageUrl(item.metadata?.images?.[0] ?? item.image ?? null);
  const art = item.media_type === "playlist" ? playlistDisplayImage(api, item, rawArt) : rawArt;
  const list = (actions ?? standardActions(api, item)).filter((a) => !a.hidden);
  const isCurrent = api.currentItem?.media_item?.uri && api.currentItem.media_item.uri === item.uri;

  // Which shortcuts fit inline right now; the panel excludes exactly these.
  const inlineLabels = wide ? INLINE_ACTION_LABELS : [];
  const inline = inlineLabels
    .map((l) => list.find((a) => a.label === l && a.run && !a.submenu))
    .filter((a): a is RowAction => !!a);

  // A click anywhere on the main row area always plays — even with the ⋯ panel
  // open, in which case it also closes the panel (feedback C). Guarded so the
  // click that precedes a dblclick doesn't fire play three times.
  const lastPlay = useRef(0);
  const playRow = () => {
    const t = Date.now();
    if (t - lastPlay.current < 350) return;
    lastPlay.current = t;
    api.unlock();
    (onPlay ?? (() => api.play(item)))();
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="rounded-md">
      <div
        className={cn(
          "group flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent focus-within:bg-accent",
          open && "bg-accent",
        )}
      >
        {dragHandle}
        <Button
          variant="ghost"
          data-no-drag
          data-music-row
          onClick={playRow}
          onDoubleClick={playRow}
          onKeyDown={(e) => {
            if (e.key === "a" && !item.uri.startsWith("queue:")) {
              e.preventDefault();
              api.play(item, "add");
            }
          }}
          className="mx-press mx-tap h-auto flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none hover:bg-transparent"
        >
          {index != null ? (
            <span className="w-5 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">
              {index}
            </span>
          ) : (
            <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded border border-border bg-background text-muted-foreground/30">
              {art ? (
                <img src={art} alt="" loading="lazy" decoding="async" fetchPriority="low" className="size-full object-cover" draggable={false} />
              ) : (
                iconFor(item.media_type)
              )}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate text-[12px]",
                isCurrent ? "text-foreground" : "text-foreground/90",
              )}
            >
              {item.name.trim()}
            </span>
            <span className="block truncate text-[10px] text-muted-foreground">{subtitleFor(item)}</span>
          </span>
        </Button>
        <RowActionButtons inline={inline} open={open} onToggle={() => setOpen((v) => !v)} />
      </div>

      {open && (
        <RowActionPanel
          actions={list}
          exclude={inline.map((a) => a.label)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
};
