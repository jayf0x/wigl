import { Radio } from "lucide-react";
import { hours, useQuery } from "@/wigl/hooks";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MediaItem } from "../../types";
import type { MusicApi } from "../../useMusic";
import { Row } from "../Row";
import { guard } from "./guard";
import { Header } from "./Header";
import { Loading } from "./parts";
import { PillBtn } from "./PillBtn";
import { PlayPills } from "./PlayPills";

interface AlbumPayload {
  tracks: MediaItem[];
  error?: string;
}

export const AlbumView = ({ api, item }: { api: MusicApi; item: MediaItem }) => {
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
