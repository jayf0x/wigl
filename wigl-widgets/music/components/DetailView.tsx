import { hours, useQuery } from "@/wigl/hooks";
import { Disc3, LoaderCircle, Radio, User } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MediaItem } from "../types";
import type { MusicApi } from "../useMusic";
import { Row } from "./Row";

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
}: {
  item: MediaItem;
  art: string | null;
  sub: string;
  actions: React.ReactNode;
}) => (
  <div className="flex gap-3 border-border border-b p-3">
    <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-background text-muted-foreground/30">
      {art ? (
        <img src={art} alt="" className="size-full object-cover" draggable={false} />
      ) : item.media_type === "artist" ? (
        <User className="size-6" />
      ) : (
        <Disc3 className="size-6" />
      )}
    </div>
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
      <p className="music-serif line-clamp-2 text-[17px] leading-tight text-foreground">
        {item.name || "—"}
      </p>
      <p className="line-clamp-1 text-[10px] text-muted-foreground">{sub}</p>
      <div className="mt-1 flex flex-wrap gap-1">{actions}</div>
    </div>
  </div>
);

const PillBtn = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    data-no-drag
    onClick={onClick}
    className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
  >
    {children}
  </button>
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
            <PillBtn onClick={() => { api.unlock(); api.play(head, "play"); }}>
              <Radio className="size-3" /> Play
            </PillBtn>
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
            <PillBtn onClick={() => { api.unlock(); api.play(item, "play"); }}>Play</PillBtn>
            <PillBtn onClick={() => api.play(item, "add")}>Add to queue</PillBtn>
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

export const DetailView = ({ api }: { api: MusicApi }) => {
  const { nav } = api;
  if (nav.kind === "artist") return <ArtistView api={api} item={nav.item} />;
  if (nav.kind === "album") return <AlbumView api={api} item={nav.item} />;
  return null;
};
