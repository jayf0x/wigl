import { type ReactNode, useEffect, useRef, useState } from "react";
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
  Pin,
  Play,
  Plus,
  Radio,
  Trash2,
  User,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/wigl/utils";
import { playlistDisplayImage } from "../playlistImage";
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
  // A radio = MA's `radio_playlist` dynamic mix seeded from this item. Only
  // track/artist/album/(non-dynamic)playlist seed one — not a radio station,
  // not an already-dynamic playlist.
  const canRadio =
    item.media_type === "track" ||
    item.media_type === "artist" ||
    item.media_type === "album" ||
    (item.media_type === "playlist" && !item.is_dynamic && item.provider !== "radio_playlist");
  const radioLabel =
    item.media_type === "artist"
      ? "Artist radio"
      : item.media_type === "album"
        ? "Album radio"
        : item.media_type === "playlist"
          ? "Playlist radio"
          : "Track radio";
  const firstArtist = item.artists?.[0];
  const fav = api.favorites.has(item.uri);
  return [
    ...extra,
    {
      label: "Play now",
      icon: <Play className="size-3.5" />,
      run: () => {
        api.unlock();
        api.play(item, "play");
      },
    },
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
      // Not for artists (no track uri) or playlists (add_playlist_tracks
      // silently no-ops on a playlist uri — verified; backlog E4, cut).
      hidden:
        item.media_type === "artist" ||
        item.media_type === "playlist" ||
        !item.uri ||
        item.uri.startsWith("queue:"),
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
      // E4 — the only real "playlist into playlist": read source tracks, append
      // each uri to the target. Playlist rows only.
      label: "Merge into…",
      icon: <ListMusic className="size-3.5" />,
      hidden:
        item.media_type !== "playlist" ||
        api.playlists.filter((p) => p.is_editable !== false && p.item_id !== item.item_id).length ===
          0,
      submenu: api.playlists
        .filter((p) => p.is_editable !== false && p.item_id !== item.item_id)
        .map((p) => ({
          label: p.name,
          icon: <ListMusic className="size-3.5" />,
          run: () => void api.mergePlaylist(item, p.item_id),
        })),
    },
    {
      label: api.pinnedPlaylists.includes(item.item_id) ? "Unpin" : "Pin to top",
      icon: <Pin className="size-3.5" />,
      run: () => api.togglePinPlaylist(item.item_id),
      hidden: item.media_type !== "playlist" || item.is_editable === false,
    },
    {
      label: radioLabel,
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

/** The actions surfaced as inline icon buttons on the row (C1), by label, in
 * render order. Which of these actually fit is decided per-row by tile width
 * (see `Row`'s `inlineLabels`); whatever ends up inline is then excluded from
 * the `⋯` panel so nothing shows twice (feedback F). */
export const INLINE_ACTION_LABELS = ["Add to queue", "Play next", "Favourite", "Remove favourite"];

/** Row width (px) at/above which the inline shortcuts get shown. Mirrors the
 * old `@container (min-width: 15rem)` rule, but measured in JS so the `⋯`
 * panel can exclude exactly what's inline. */
const INLINE_MIN_PX = 232;

/** The `⋯` toggle plus the inline icon shortcuts, rendered inside the row's
 * flex line. `open`/`onToggle` are owned by the caller so the fold-down
 * `<RowActionPanel>` can live as its sibling. */
export const RowActionButtons = ({
  inline,
  open,
  onToggle,
}: {
  /** the already-resolved inline actions (subset of the row's action set) */
  inline: RowAction[];
  open: boolean;
  onToggle: () => void;
}) => (
  <>
    {inline.length > 0 && (
      <div className="music-row-inline shrink-0 items-center gap-0.5">
        {inline.map((a) => (
          <Tooltip key={a.label} content={a.label}>
            <button
              type="button"
              data-no-drag
              aria-label={a.label}
              onClick={() => a.run?.()}
              className={cn(
                "mx-press mx-tap rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:opacity-100",
                open
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
              )}
            >
              {a.icon}
            </button>
          </Tooltip>
        ))}
      </div>
    )}
    <button
      type="button"
      data-no-drag
      aria-label="More actions"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        "mx-press shrink-0 rounded p-1 text-muted-foreground transition-opacity hover:bg-muted hover:text-foreground",
        open ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
      )}
    >
      <Ellipsis className="size-3.5" />
    </button>
  </>
);

/** The fold-down pill strip: the full action list, with submenu + inline-input
 * support. Caller renders it conditionally on its own `open` state. */
export const RowActionPanel = ({
  actions,
  onClose,
  className,
  exclude,
}: {
  actions: RowAction[];
  onClose: () => void;
  className?: string;
  /** labels already shown as inline shortcuts on the row — dropped here so the
   * panel is pure overflow, never a duplicate (feedback F). */
  exclude?: string[];
}) => {
  const [sub, setSub] = useState<RowAction | null>(null);
  const [text, setText] = useState("");
  const list = actions.filter(
    (a) => !a.hidden && !(exclude?.includes(a.label) && a.run && !a.submenu),
  );
  const pills = sub?.submenu ? sub.submenu.filter((a) => !a.hidden) : list;
  const close = () => {
    setSub(null);
    setText("");
    onClose();
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-1 px-2 pt-1 pb-2", className)}>
      {sub && (
        <button
          type="button"
          data-no-drag
          onClick={() => {
            setSub(null);
            setText("");
          }}
          className="mx-press flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
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
            className="mx-press rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            add
          </button>
        </form>
      ) : (
        pills.map((a) => {
          const branch = !!(a.submenu || a.input);
          // Top-level plain actions collapse to an icon + hover/focus tooltip
          // on the whole button (P5.1); submenu contents (playlist names, radio
          // seeds) and any branch keep their text label — an icon alone
          // wouldn't name them.
          const iconOnly = !sub && !branch;
          const btn = (
            <button
              key={a.label}
              type="button"
              data-no-drag
              aria-label={a.label}
              onClick={() => {
                if (branch) setSub(a);
                else {
                  a.run?.();
                  close();
                }
              }}
              className={cn(
                "mx-press flex items-center gap-1.5 rounded border border-border text-[10px] transition-colors hover:bg-muted",
                iconOnly ? "p-1.5" : "px-2 py-1",
                a.danger
                  ? "text-muted-foreground hover:text-destructive"
                  : "text-muted-foreground hover:text-foreground",
                a.run && !branch && "mx-tap",
              )}
            >
              {a.icon}
              {!iconOnly && (
                <>
                  <span className="max-w-32 truncate">{a.label}</span>
                  {branch && <ChevronRight className="size-3" />}
                </>
              )}
            </button>
          );
          return iconOnly ? (
            <Tooltip key={a.label} content={a.label}>
              {btn}
            </Tooltip>
          ) : (
            btn
          );
        })
      )}
    </div>
  );
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
        <button
          type="button"
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
          className="mx-press mx-tap flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none"
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
        </button>
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

export { Trash2 };
