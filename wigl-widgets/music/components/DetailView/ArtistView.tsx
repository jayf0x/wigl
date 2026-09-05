import { Radio } from "lucide-react";
import { hours, useQuery } from "@/wigl/hooks";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MediaItem } from "../../types";
import type { MusicApi } from "../../useMusic";
import { Row } from "../Row";
import { guard } from "./guard";
import { Header } from "./Header";
import { Loading, SectionLabel } from "./parts";
import { PillBtn } from "./PillBtn";
import { PlayPills } from "./PlayPills";

interface ArtistPayload {
  header: MediaItem | null;
  topTracks: MediaItem[];
  albums: MediaItem[];
  similar: MediaItem[];
  error?: string;
}

export const ArtistView = ({ api, item }: { api: MusicApi; item: MediaItem }) => {
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
