import { useEffect, useState } from "react";
import { hours, useQuery } from "@/wigl/hooks";
import { Disc3, GripVertical, LoaderCircle, Radio, Trash2, User } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/wigl/utils";
import { PLAYLIST_RENDER_CAP } from "../music.config";
import { pickImageDataUri } from "../pickImage";
import { playlistDisplayImage } from "../playlistImage";
import type { MediaItem } from "../types";
import type { MusicApi } from "../useMusic";
import { arrayMove } from "../util";
import { Row, standardActions } from "./Row";
import { useDragReorder } from "./useDragReorder";

interface ArtistPayload {
  header: MediaItem | null;
  topTracks: MediaItem[];
  albums: MediaItem[];
  similar: MediaItem[];
  error?: string;
}

interface AlbumPayload {
  tracks: MediaItem[];
  error?: string;
}

const guard = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    console.warn("[music] detail fetch", e);
    return fallback;
  }
};

const Header = ({
  item,
  art,
  sub,
  actions,
  title,
  bgImage,
}: {
  item: MediaItem;
  art: string | null;
  sub: string;
  actions: React.ReactNode;
  /** overrides `item.name` (used for a live rename before the nav item updates) */
  title?: string;
  /** E3 — a data-URI background for the playlist header, dimmed for legibility */
  bgImage?: string | null;
}) => (
  <div className="relative flex gap-3 overflow-hidden border-border border-b p-3">
    {bgImage && (
      <>
        <div
          className="absolute inset-0 bg-center bg-cover"
          style={{ backgroundImage: `url("${bgImage}")` }}
        />
        <div className="absolute inset-0 bg-background/80" />
      </>
    )}
    <div className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-background text-muted-foreground/30">
      {art ? (
        <img src={art} alt="" loading="lazy" decoding="async" fetchPriority="low" className="size-full object-cover" draggable={false} />
      ) : item.media_type === "artist" ? (
        <User className="size-6" />
      ) : (
        <Disc3 className="size-6" />
      )}
    </div>
    <div className="relative flex min-w-0 flex-1 flex-col justify-center gap-1">
      <p className="music-serif line-clamp-2 text-[17px] leading-tight text-foreground">
        {title ?? item.name ?? "—"}
      </p>
      <p className="line-clamp-1 text-[10px] text-muted-foreground">{sub}</p>
      <div className="mt-1 flex flex-wrap gap-1">{actions}</div>
    </div>
  </div>
);

const PillBtn = ({
  onClick,
  children,
  tap,
}: {
  onClick: () => void;
  children: React.ReactNode;
  /** fires audio — add the click ring-pulse */
  tap?: boolean;
}) => (
  <button
    type="button"
    data-no-drag
    onClick={onClick}
    className={cn(
      "mx-press flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
      tap && "mx-tap",
    )}
  >
    {children}
  </button>
);

/** Primary "play this collection" button — always starts playback now; the
 * queue-mode toggle only decides whether the current tail survives. An explicit
 * "Add to queue" sits alongside in append mode for the silent-append case. */
const PlayPills = ({ api, item }: { api: MusicApi; item: MediaItem }) => (
  <>
    <PillBtn
      tap
      onClick={() => {
        api.unlock();
        api.play(item);
      }}
    >
      Play
    </PillBtn>
    {api.queueMode !== "replace" && (
      <PillBtn
        tap
        onClick={() => {
          api.unlock();
          api.play(item, "add");
        }}
      >
        Add to queue
      </PillBtn>
    )}
  </>
);

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="music-tag px-2 pt-3 pb-1 text-muted-foreground/70">{children}</p>
);

const Loading = () => (
  <div className="flex flex-1 items-center justify-center py-10 text-muted-foreground">
    <LoaderCircle className="size-4 animate-spin" />
  </div>
);

const ArtistView = ({ api, item }: { api: MusicApi; item: MediaItem }) => {
  const [data, loading] = useQuery<ArtistPayload>({
    key: `artist:${item.uri || `${item.provider}/${item.item_id}`}`,
    stale: hours(6),
    fn: async () => {
      const idArgs = { item_id: item.item_id, provider_instance_id_or_domain: item.provider };
      const [header, topTracks, albums, similar] = await Promise.all([
        item.item_id
          ? guard(() => api.request<MediaItem>("music/artists/get", { ...idArgs, allow_update_metadata: false }), null)
          : guard(() => api.request<MediaItem>("music/item_by_uri", { uri: item.uri }), null),
        item.item_id ? guard(() => api.request<MediaItem[]>("music/artists/top_tracks", idArgs), []) : [],
        item.item_id ? guard(() => api.request<MediaItem[]>("music/artists/artist_albums", idArgs), []) : [],
        item.item_id ? guard(() => api.request<MediaItem[]>("music/artists/similar_artists", { ...idArgs, limit: 8 }), []) : [],
      ]);
      return { header, topTracks, albums, similar };
    },
  });

  if (loading && !data) return <Loading />;
  const head = data?.header ?? item;
  const art = api.imageUrl(head.metadata?.images?.[0] ?? null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header
        item={head}
        art={art}
        sub={head.metadata?.genres?.slice(0, 3).join(" · ") || "Artist"}
        actions={
          <>
            <PlayPills api={api} item={head} />
            <PillBtn onClick={() => { api.unlock(); api.startRadio(head); }}>
              <Radio className="size-3" /> Artist radio
            </PillBtn>
          </>
        }
      />
      <ScrollArea className="min-h-0 flex-1" scrollFade>
        <div className="p-1.5">
          {data?.topTracks.length ? (
            <>
              <SectionLabel>Top tracks</SectionLabel>
              {data.topTracks.slice(0, 10).map((t) => (
                <Row key={t.uri} item={t} api={api} />
              ))}
            </>
          ) : null}
          {data?.albums.length ? (
            <>
              <SectionLabel>Albums</SectionLabel>
              {data.albums.map((a) => (
                <Row key={a.uri} item={a} api={api} onPlay={() => api.navTo({ kind: "album", item: a })} />
              ))}
            </>
          ) : null}
          {data?.similar.length ? (
            <>
              <SectionLabel>Similar artists</SectionLabel>
              {data.similar.map((a) => (
                <Row key={a.uri} item={a} api={api} onPlay={() => api.navTo({ kind: "artist", item: a })} />
              ))}
            </>
          ) : null}
          {!loading && !data?.topTracks.length && !data?.albums.length ? (
            <p className="px-2 py-8 text-center text-[11px] text-muted-foreground">
              Nothing to show for this artist.
            </p>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
};

const AlbumView = ({ api, item }: { api: MusicApi; item: MediaItem }) => {
  const [data, loading] = useQuery<AlbumPayload>({
    key: `album:${item.uri || `${item.provider}/${item.item_id}`}`,
    stale: hours(6),
    fn: async () => {
      const tracks = item.item_id
        ? await guard(
            () =>
              api.request<MediaItem[]>("music/albums/album_tracks", {
                item_id: item.item_id,
                provider_instance_id_or_domain: item.provider,
              }),
            [],
          )
        : [];
      return { tracks };
    },
  });

  if (loading && !data) return <Loading />;
  const art = api.imageUrl(item.metadata?.images?.[0] ?? data?.tracks[0]?.metadata?.images?.[0] ?? null);
  const artistSub =
    item.artists?.map((a) => a.name).join(", ") ||
    data?.tracks[0]?.artists?.map((a) => a.name).join(", ") ||
    "Album";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header
        item={item}
        art={art}
        sub={[artistSub, item.year].filter(Boolean).join(" · ")}
        actions={
          <>
            <PlayPills api={api} item={item} />
            <PillBtn onClick={() => api.startRadio(item)}>
              <Radio className="size-3" /> Album radio
            </PillBtn>
          </>
        }
      />
      <ScrollArea className="min-h-0 flex-1" scrollFade>
        <div className="p-1.5">
          {data?.tracks.length ? (
            data.tracks.map((t, i) => (
              <Row key={t.uri} item={t} api={api} index={t.track_number ?? i + 1} />
            ))
          ) : (
            <p className="px-2 py-8 text-center text-[11px] text-muted-foreground">
              {loading ? "" : "No tracks found for this album."}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

const PlaylistView = ({ api, item }: { api: MusicApi; item: MediaItem }) => {
  const [confirmDel, setConfirmDel] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const bg = api.playlistImages[item.item_id] ?? null;
  const [data, loading, { refresh }] = useQuery<{ tracks: MediaItem[] }>({
    key: `playlist:${item.item_id}`,
    stale: 60_000,
    fn: async () => {
      const tracks = await guard(
        () =>
          api.request<MediaItem[]>("music/playlists/playlist_tracks", {
            item_id: item.item_id,
            // library playlists resolve under "library"; a radio_playlist://
            // (or other provider) playlist needs its own provider.
            provider_instance_id_or_domain:
              item.provider && item.provider !== "library" ? item.provider : "library",
          }),
        [],
      );
      return { tracks };
    },
  });

  // Optimistic order during / just after a drag-reorder (P6.2); cleared when a
  // fresh server fetch lands.
  const [order, setOrder] = useState<MediaItem[] | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on a new fetch
  useEffect(() => setOrder(null), [data?.tracks]);

  if (loading && !data) return <Loading />;
  const tracks = order ?? data?.tracks ?? [];
  // Only real library playlists can be renamed / deleted / have tracks added.
  const editable = item.is_editable !== false && (!item.provider || item.provider === "library");
  const shownName = nameOverride ?? item.name;
  // Custom background wins over MA art and the first-track fallback (feedback E).
  const art = playlistDisplayImage(
    api,
    item,
    api.imageUrl(tracks[0]?.metadata?.images?.[0] ?? null),
  );

  const canReorder = editable && tracks.length > 1 && tracks.length <= PLAYLIST_RENDER_CAP;
  const dnd = useDragReorder(tracks, (from, to) => {
    const next = arrayMove(tracks, from, to);
    setOrder(next);
    void api
      .reorderPlaylist(
        item.item_id,
        next.map((t) => t.uri).filter((u): u is string => !!u),
      )
      .then(() => setTimeout(refresh, 900));
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header
        item={item}
        art={art}
        title={shownName}
        bgImage={bg}
        sub={`${tracks.length} track${tracks.length === 1 ? "" : "s"}${item.owner ? ` · ${item.owner}` : ""}`}
        actions={
          <>
            <PlayPills api={api} item={item} />
            {editable && renaming ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = (nameOverride ?? item.name).trim();
                  if (v) void api.renamePlaylist(item, v);
                  setRenaming(false);
                }}
              >
                {/* biome-ignore lint/a11y/noAutofocus: opened by an explicit click */}
                <input
                  data-no-drag
                  autoFocus
                  value={shownName}
                  onChange={(e) => setNameOverride(e.target.value)}
                  className="w-32 rounded border border-border bg-input/40 px-2 py-1 text-[10px] text-foreground outline-none"
                />
                <button
                  type="submit"
                  data-no-drag
                  className="mx-press rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  save
                </button>
              </form>
            ) : (
              editable && <PillBtn onClick={() => setRenaming(true)}>Rename</PillBtn>
            )}
            {editable && !renaming && (
              <PillBtn onClick={() => api.togglePinPlaylist(item.item_id)}>
                {api.pinnedPlaylists.includes(item.item_id) ? "Unpin" : "Pin to top"}
              </PillBtn>
            )}
            {editable && !renaming && (
              <PillBtn
                onClick={async () => {
                  if (bg) {
                    api.setPlaylistImage(item.item_id, null);
                    return;
                  }
                  setPicking(true);
                  const uri = await pickImageDataUri();
                  if (uri) api.setPlaylistImage(item.item_id, uri);
                  setPicking(false);
                }}
              >
                {picking ? "choosing…" : bg ? "Remove image" : "Background image"}
              </PillBtn>
            )}
            {editable &&
              !renaming &&
              (confirmDel ? (
                <PillBtn
                  onClick={() => {
                    api.deletePlaylist(item);
                    api.navBack();
                  }}
                >
                  really delete?
                </PillBtn>
              ) : (
                <PillBtn onClick={() => setConfirmDel(true)}>Delete</PillBtn>
              ))}
          </>
        }
      />
      <ScrollArea className="min-h-0 flex-1" scrollFade>
        <div className="p-1.5">
          {dnd.list.length ? (
            <>
              {dnd.list.slice(0, PLAYLIST_RENDER_CAP).map((t, i) => {
                const pos = order ? i + 1 : (t.position ?? i + 1);
                const key = `${t.uri}:${i}`;
                return (
                  <div key={key} data-reorder-row style={canReorder ? dnd.rowStyle(i, key) : undefined}>
                    <Row
                      item={t}
                      api={api}
                      index={i + 1}
                      actions={
                        editable
                          ? standardActions(api, t, [
                              {
                                label: "Remove from playlist",
                                icon: <Trash2 className="size-3.5" />,
                                danger: true,
                                run: async () => {
                                  await api.removePlaylistTrack(item.item_id, pos);
                                  setTimeout(refresh, 600);
                                },
                              },
                            ])
                          : undefined
                      }
                      dragHandle={
                        canReorder ? (
                          <button
                            type="button"
                            data-no-drag
                            aria-label="Drag to reorder"
                            {...dnd.handleFor(key, i)}
                            className="-ml-1 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground/40 hover:text-foreground active:cursor-grabbing"
                          >
                            <GripVertical className="size-3.5" />
                          </button>
                        ) : undefined
                      }
                    />
                  </div>
                );
              })}
              {tracks.length > PLAYLIST_RENDER_CAP && (
                <p className="px-2 py-3 text-center text-[10px] text-muted-foreground/70">
                  showing first {PLAYLIST_RENDER_CAP} of {tracks.length} — Play all still queues
                  everything
                </p>
              )}
            </>
          ) : (
            <p className="px-2 py-8 text-center text-[11px] text-muted-foreground">
              {loading ? "" : "This playlist is empty."}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export const DetailView = ({ api }: { api: MusicApi }) => {
  const { nav } = api;
  if (nav.kind === "artist") return <ArtistView api={api} item={nav.item} />;
  if (nav.kind === "album") return <AlbumView api={api} item={nav.item} />;
  if (nav.kind === "playlist") return <PlaylistView api={api} item={nav.item} />;
  return null;
};
