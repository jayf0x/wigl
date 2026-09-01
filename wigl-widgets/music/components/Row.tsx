import { type ReactNode, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Disc3,
  Ellipsis,
  Heart,
  ListEnd,
  ListMusic,
  ListPlus,
  MicVocal,
  Music2,
  Plus,
  Radio,
  Trash2,
  User,
} from "lucide-react";
import { cn } from "@/wigl/utils";
import type { MediaItem } from "../types";
import type { MusicApi } from "../useMusic";

/** One action in a row's fold-down menu. `hidden` drops it entirely.
 * `submenu` swaps the pill strip for a nested set; `input` swaps it for a
 * one-field text form whose value is passed to `run`'s companion `onInput`. */
export interface RowAction {
  label: string;
  icon: ReactNode;
  run?: () => void;
  hidden?: boolean;
  danger?: boolean;
  submenu?: RowAction[];
  input?: { placeholder: string; onSubmit: (value: string) => void };
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
      label: "Add to playlist",
      icon: <ListMusic className="size-3.5" />,
      hidden: item.media_type === "artist" || !item.uri || item.uri.startsWith("queue:"),
      submenu: [
        {
          label: "New playlist…",
          icon: <Plus className="size-3.5" />,
          input: {
            placeholder: "Playlist name",
            onSubmit: async (name) => {
              const pl = await api.createPlaylist(name);
              if (pl) await api.addToPlaylist(pl.item_id, [item.uri]);
            },
          },
        },
        ...api.playlists
          .filter((p) => p.is_editable !== false)
          .map((p) => ({
            label: p.name,
            icon: <ListMusic className="size-3.5" />,
            run: () => void api.addToPlaylist(p.item_id, [item.uri]),
          })),
      ],
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
  const [sub, setSub] = useState<RowAction | null>(null);
  const [text, setText] = useState("");
  const art = api.imageUrl(item.metadata?.images?.[0] ?? null);
  const list = (actions ?? standardActions(api, item)).filter((a) => !a.hidden);
  const isCurrent = api.currentItem?.media_item?.uri && api.currentItem.media_item.uri === item.uri;

  const close = () => {
    setOpen(false);
    setSub(null);
    setText("");
  };
  const pills = sub?.submenu ? sub.submenu.filter((a) => !a.hidden) : list;

  return (
    <div className="rounded-md">
      <div className={cn("group flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent", open && "bg-accent")}>
        {dragHandle}
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
          onClick={() => (open ? close() : setOpen(true))}
          className={cn(
            "shrink-0 rounded p-1 text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground",
            open ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
          )}
        >
          <Ellipsis className="size-3.5" />
        </button>
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-1 px-2 pt-1 pb-2">
          {sub && (
            <button
              type="button"
              data-no-drag
              onClick={() => {
                setSub(null);
                setText("");
              }}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="size-3.5" /> back
            </button>
          )}
          {sub?.input ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) sub.input?.onSubmit(text.trim());
                close();
              }}
            >
              {/* biome-ignore lint/a11y/noAutofocus: opens on an explicit user click */}
              <input
                data-no-drag
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={sub.input.placeholder}
                className="w-32 rounded border border-border bg-input/40 px-2 py-1 text-[10px] text-foreground outline-none placeholder:text-muted-foreground/60"
              />
              <button
                type="submit"
                data-no-drag
                className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                add
              </button>
            </form>
          ) : (
            pills.map((a) => (
              <button
                key={a.label}
                type="button"
                data-no-drag
                onClick={() => {
                  if (a.submenu || a.input) setSub(a);
                  else {
                    a.run?.();
                    close();
                  }
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[10px] transition-colors hover:bg-muted",
                  a.danger
                    ? "text-muted-foreground hover:text-destructive"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {a.icon}
                <span className="max-w-32 truncate">{a.label}</span>
                {(a.submenu || a.input) && <ChevronRight className="size-3" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export { Trash2 };
