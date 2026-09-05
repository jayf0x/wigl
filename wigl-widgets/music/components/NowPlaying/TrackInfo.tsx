import type { ReactNode } from "react";
import { hours, useQuery } from "@/wigl/hooks";
import { Button } from "@/components/ui/button";
import type { MediaItem } from "../../types";
import type { MusicApi } from "../../useMusic";
import { providerLabel } from "../../util";
import { Credit } from "./Credit";

const asArray = (v: string[] | string | null | undefined): string[] =>
  Array.isArray(v) ? v : v ? [v] : [];

/** P3 / C3 — fold-down "what am I hearing" panel. Live stream details off the
 * current queue item, plus the fuller `music/tracks/get` metadata fetched once
 * per track (cached). Facts only — no lyrics, no visualiser. */
export const TrackInfo = ({ api }: { api: MusicApi }) => {
  const it = api.currentItem;
  const base = it?.media_item ?? null;
  const sd = it?.streamdetails ?? null;
  const af = sd?.audio_format ?? null;

  const [full] = useQuery<MediaItem | null>({
    key: `track:${base?.uri ?? "none"}`,
    stale: hours(6),
    fn: async () => {
      if (!base?.item_id || !base.provider || base.media_type !== "track") return null;
      try {
        return await api.request<MediaItem>("music/tracks/get", {
          item_id: base.item_id,
          provider_instance_id_or_domain: base.provider,
        });
      } catch {
        return null;
      }
    },
  });
  const media = full ?? base;
  const md = media?.metadata ?? null;

  const rows: [string, ReactNode][] = [];

  const artists = media?.artists ?? [];
  if (artists.length) {
    rows.push([
      artists.length > 1 ? "Artists" : "Artist",
      <span key="a" className="flex flex-wrap gap-1">
        {artists.map((a) => (
          <Credit key={a.name} api={api} name={a.name} artist={a} />
        ))}
      </span>,
    ]);
  }

  const album = media?.album ?? null;
  if (album?.name) {
    rows.push([
      "Album",
      album.uri || album.item_id ? (
        <Button
          variant="link"
          data-no-drag
          className="h-auto truncate p-0 text-inherit text-left hover:text-foreground"
          onClick={() =>
            api.navTo({
              kind: "album",
              item: {
                item_id: album.item_id ?? "",
                provider: album.provider ?? media?.provider ?? "",
                name: album.name,
                uri: album.uri ?? "",
                media_type: "album",
              },
            })
          }
        >
          {album.name}
        </Button>
      ) : (
        album.name
      ),
    ]);
  }

  const performers = (md?.performers ?? [])
    .map((p) => (typeof p === "string" ? p : p?.name))
    .filter((n): n is string => !!n);
  if (performers.length) {
    rows.push([
      "Credits",
      <span key="p" className="flex flex-wrap gap-1">
        {performers.slice(0, 8).map((n) => (
          <Credit key={n} api={api} name={n} />
        ))}
      </span>,
    ]);
  }

  const year = media?.year ?? album?.year ?? (md?.release_date ? Number(md.release_date.slice(0, 4)) : null);
  if (year) rows.push(["Year", String(year)]);

  const label = asArray(md?.label);
  if (label.length) rows.push(["Label", label.join(", ")]);

  const genres = [...asArray(md?.genres), ...asArray(md?.style)];
  if (genres.length) rows.push(["Genre", [...new Set(genres)].slice(0, 4).join(", ")]);

  const source = providerLabel(sd?.provider ?? media?.provider);
  if (source) rows.push(["Source", source]);
  if (af?.codec_type || af?.content_type) {
    const parts = [
      (af.codec_type ?? af.content_type ?? "").toUpperCase(),
      af.sample_rate ? `${(af.sample_rate / 1000).toFixed(1).replace(/\.0$/, "")} kHz` : null,
      af.bit_depth ? `${af.bit_depth}-bit` : null,
      af.bit_rate ? `${Math.round(af.bit_rate)} kbps` : null,
    ].filter(Boolean);
    rows.push(["Format", parts.join(" · ")]);
  }
  if (sd?.loudness != null) rows.push(["Loudness", `${sd.loudness.toFixed(1)} LUFS`]);
  if (md?.popularity != null) rows.push(["Popularity", `${Math.round(md.popularity)} / 100`]);

  const description = md?.description?.trim();

  if (rows.length === 0 && !description)
    return <p className="px-1 py-2 text-[10px] text-muted-foreground">No track details available.</p>;

  return (
    <div className="flex flex-col gap-2 px-1 py-1">
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 text-[10px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="music-tag pt-0.5 text-muted-foreground/70">{k}</dt>
              <dd className="min-w-0 text-foreground/90">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {description && (
        <p className="line-clamp-4 text-[10px] leading-relaxed text-muted-foreground">{description}</p>
      )}
    </div>
  );
};
