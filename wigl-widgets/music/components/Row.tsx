import { type ReactNode, useState } from "react";
import { Disc3, Ellipsis, Heart, ListEnd, ListPlus, MicVocal, Music2, Radio, Trash2, User } from "lucide-react";
import { cn } from "@/wigl/utils";
import type { MediaItem } from "../types";
import type { MusicApi } from "../useMusic";

/** One action in a row's fold-down menu. `hidden` drops it entirely. */
export interface RowAction {
  label: string;
  icon: ReactNode;
  run: () => void;
  hidden?: boolean;
  danger?: boolean;
}

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

/** Build the standard action set for a media item. Queue-row extras (remove,
 * move) are passed in by the caller via `extra`. */
export const standardActions = (
  api: MusicApi,
  item: MediaItem,
  extra: RowAction[] = [],
): RowAction[] => {
  const canRadio =
    item.media_type === "radio" || item.media_type === "artist" || item.media_type === "track";
  const firstArtist = item.artists?.[0];
  const fav = api.favorites.has(item.uri);
  return [
    ...extra,
    {
      label: "Play next",
      icon: <ListPlus className="size-3.5" />,
      run: () => api.play(item, "next"),
    },
    {
      label: "Add to queue",
      icon: <ListEnd className="size-3.5" />,
      run: () => api.play(item, "add"),
    },
    {
      label: fav ? "Remove favourite" : "Favourite",
      icon: <Heart className={cn("size-3.5", fav && "fill-current")} />,
      run: () => api.toggleFavorite(item),
    },
    {
      label: "Start radio",
      icon: <Radio className="size-3.5" />,
      run: () => api.startRadio(item),
      hidden: !canRadio,
    },
    {
      label: "Go to artist",
      icon: <MicVocal className="size-3.5" />,
      run: () =>
        api.navTo({
          kind: "artist",
          item: {
            item_id: firstArtist?.item_id ?? "",
            provider: firstArtist?.provider ?? item.provider,
            name: firstArtist?.name ?? "",
            uri: firstArtist?.uri ?? "",
            media_type: "artist",
          },
        }),
      hidden:
        item.media_type === "artist" ||
        !firstArtist ||
        (!firstArtist.uri && !firstArtist.item_id),
    },
    {
      label: "Go to album",
      icon: <Disc3 className="size-3.5" />,
      run: () =>
        item.album &&
        api.navTo({
          kind: "album",
          item: {
            item_id: item.album.item_id ?? "",
            provider: item.album.provider ?? item.provider,
            name: item.album.name,
            uri: item.album.uri ?? "",
            media_type: "album",
          },
        }),
      hidden:
        item.media_type === "album" ||
        !item.album ||
        (!item.album.uri && !item.album.item_id),
    },
  ];
};

export const Row = ({
  item,
  api,
  index,
  actions,
  onPlay,
}: {
  item: MediaItem;
  api: MusicApi;
  /** shown as a left-hand number when provided (queue / album track lists) */
  index?: number;
  /** override the action set; defaults to `standardActions(api, item)` */
  actions?: RowAction[];
  /** override the left-click; defaults to non-destructive play-now */
  onPlay?: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const art = api.imageUrl(item.metadata?.images?.[0] ?? null);
  const list = (actions ?? standardActions(api, item)).filter((a) => !a.hidden);
  const isCurrent = api.currentItem?.media_item?.uri && api.currentItem.media_item.uri === item.uri;

  return (
    <div className="rounded-md">
      <div className={cn("group flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent", open && "bg-accent")}>
        <button
          type="button"
          data-no-drag
          onClick={() => {
            api.unlock();
            (onPlay ?? (() => api.play(item, "play")))();
          }}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          {index != null ? (
            <span className="w-5 shrink-0 text-right text-[10px] text-muted-foreground tabular-nums">
              {index}
            </span>
          ) : (
            <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded border border-border bg-background text-muted-foreground/30">
              {art ? (
                <img src={art} alt="" className="size-full object-cover" draggable={false} />
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
        </button>
        <button
          type="button"
          data-no-drag
          aria-label="More actions"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "shrink-0 rounded p-1 text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground",
            open ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
          )}
        >
          <Ellipsis className="size-3.5" />
        </button>
      </div>

      {open && (
        <div className="flex flex-wrap gap-1 px-2 pt-1 pb-2">
          {list.map((a) => (
            <button
              key={a.label}
              type="button"
              data-no-drag
              onClick={() => {
                a.run();
                setOpen(false);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[10px] transition-colors hover:bg-muted",
                a.danger
                  ? "text-muted-foreground hover:text-destructive"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export { Trash2 };
