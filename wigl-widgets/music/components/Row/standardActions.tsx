import type { ReactNode } from "react";
import { Disc3, Heart, ListEnd, ListMusic, ListPlus, MicVocal, Pin, Play, Plus, Radio } from "lucide-react";
import { cn } from "@/wigl/utils";
import type { MediaItem } from "../../types";
import type { MusicApi } from "../../useMusic";

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
