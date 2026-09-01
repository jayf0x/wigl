import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import {
  Disc3,
  Ellipsis,
  Heart,
  Info,
  ListPlus,
  Pause,
  Play,
  Radio,
  Repeat,
  Repeat1,
  Replace,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { hours, useQuery, useStorage } from "@/wigl/hooks";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/wigl/utils";
import { PROGRESS_TICK_MS } from "../music.config";
import type { MediaArtistRef, MediaItem } from "../types";
import type { MusicApi } from "../useMusic";
import { providerLabel } from "../util";
import { RowActionPanel, standardActions } from "./Row";

const asArray = (v: string[] | string | null | undefined): string[] =>
  Array.isArray(v) ? v : v ? [v] : [];

/** A clickable credit — an artist name navigates to the artist view when it
 * resolves to a real library artist, otherwise (and for plain composer /
 * performer strings) it runs a search for the name. */
const Credit = ({ api, name, artist }: { api: MusicApi; name: string; artist?: MediaArtistRef }) => (
  <button
    type="button"
    data-no-drag
    onClick={() => {
      if (artist?.uri?.startsWith("library://artist/") && artist.item_id) {
        api.navTo({
          kind: "artist",
          item: {
            item_id: artist.item_id,
            provider: artist.provider ?? "library",
            name: artist.name,
            uri: artist.uri,
            media_type: "artist",
          },
        });
      } else {
        api.navHome();
        api.search(name);
      }
    }}
    className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
  >
    {name}
  </button>
);

/** P3 / C3 — fold-down "what am I hearing" panel. Live stream details off the
 * current queue item, plus the fuller `music/tracks/get` metadata fetched once
 * per track (cached). Facts only — no lyrics, no visualiser. */
const TrackInfo = ({ api }: { api: MusicApi }) => {
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
        <button
          type="button"
          data-no-drag
          className="truncate text-left hover:text-foreground hover:underline"
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
        </button>
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

const fmt = (s: number) => {
  if (!s || s < 0 || !Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

const Artwork = ({ url, radio }: { url: string | null; radio: boolean }) => {
  const [broken, setBroken] = useState(false);
  return (
    <div className="relative aspect-square w-full shrink-0 overflow-hidden rounded-md border border-border bg-background">
      {url && !broken ? (
        <img
          src={url}
          alt=""
          className="size-full object-cover"
          onError={() => setBroken(true)}
          draggable={false}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground/30">
          {radio ? <Radio className="size-1/3" /> : <Disc3 className="size-1/3" />}
        </div>
      )}
    </div>
  );
};

const IconBtn = ({
  onClick,
  label,
  primary,
  active,
  disabled,
  pending,
  tap,
  children,
}: {
  onClick: () => void;
  label: string;
  primary?: boolean;
  active?: boolean;
  disabled?: boolean;
  /** action is in flight — calm shimmer (mx-pending) */
  pending?: boolean;
  /** fires an async API call — click gets the mx-tap ring pulse */
  tap?: boolean;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    data-no-drag
    aria-label={label}
    aria-pressed={active}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      "mx-press flex items-center justify-center rounded-full transition-colors disabled:opacity-40",
      tap && "mx-tap",
      pending && "mx-pending",
      primary
        ? "size-9 bg-foreground text-background hover:bg-foreground/85"
        : active
          ? "size-7 text-foreground"
          : "size-7 text-muted-foreground hover:text-foreground",
    )}
  >
    {children}
  </button>
);

/** Click / drag the timeline to seek. Frozen to the drag position while the
 * pointer is down; snaps back to the live `elapsed` on release + reconcile. */
const Scrubber = ({ api }: { api: MusicApi }) => {
  const { now } = api;
  const barRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null); // fraction 0..1 while dragging
  const duration = now?.duration ?? 0;

  // Smooth clock (A2): sample the SDK's live position while playing so the
  // label/scrubber tick every frame instead of jumping on MA's sparse
  // `queue_time_updated`. Falls back to the event-seeded `now.elapsed`.
  const [live, setLive] = useState<number | null>(null);
  const playing = !!now?.playing;
  useEffect(() => {
    if (!playing) {
      setLive(null);
      return;
    }
    // `api.getProgress()` already holds the seeked target for ~1.5s after a
    // local seek (hook-side), so this never snaps backward on a scrub.
    const read = () => {
      const p = api.getProgress();
      setLive(p && p.position > 0 ? p.position : null);
    };
    read();
    const id = setInterval(read, PROGRESS_TICK_MS);
    return () => clearInterval(id);
  }, [playing, api]);
  const elapsed = drag == null ? (live ?? now?.elapsed ?? 0) : now?.elapsed ?? 0;

  const fracFromEvent = (e: ReactPointerEvent | PointerEvent) => {
    const el = barRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!now || now.isRadio || duration <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(fracFromEvent(e));
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag == null) return;
    setDrag(fracFromEvent(e));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag == null) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const target = drag * duration;
    api.seek(target);
    setLive(target);
    setDrag(null);
  };

  const livePct = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;
  const pct = drag != null ? drag * 100 : livePct;
  const shownElapsed = drag != null ? drag * duration : elapsed;
  const seekable = !!now && !now.isRadio && duration > 0;

  return (
    <div className="flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums">
      <span className="w-8">{now?.isRadio ? "live" : fmt(shownElapsed)}</span>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-driven scrubber, keyboard seek is on the widget root */}
      <div
        ref={barRef}
        data-no-drag
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        className={cn("group relative flex h-3 flex-1 items-center", seekable && "cursor-pointer")}
      >
        <span className="relative h-px w-full bg-border">
          {seekable && (
            <>
              <span className="absolute inset-y-0 left-0 bg-foreground" style={{ width: `${pct}%` }} />
              <span
                className={cn(
                  "absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground transition-opacity",
                  drag != null ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                style={{ left: `${pct}%` }}
              />
            </>
          )}
        </span>
      </div>
      <span className="w-8 text-right">{seekable ? fmt(duration) : ""}</span>
    </div>
  );
};

const VolumeControl = ({ api }: { api: MusicApi }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = wrapRef.current;
    if (!el) return;
    const close = (e: Event) => {
      if (!el.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);

  const Icon = api.volume === 0 ? VolumeX : api.volume < 50 ? Volume1 : Volume2;

  return (
    <div ref={wrapRef} className="flex items-center gap-2" data-no-drag>
      {open && (
        <>
          <Slider
            className="w-20"
            value={[api.volume]}
            min={0}
            max={100}
            onValueChange={(v) => api.setVolume(Array.isArray(v) ? v[0] : v)}
          />
          <span className="w-5 text-right text-[10px] text-muted-foreground tabular-nums">
            {Math.round(api.volume)}
          </span>
        </>
      )}
      <button
        type="button"
        data-no-drag
        aria-label={open ? "Hide volume" : "Volume"}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "mx-press rounded-md p-1 transition-colors",
          open ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon className="size-3.5" />
      </button>
    </div>
  );
};

export const NowPlaying = ({ api }: { api: MusicApi }) => {
  const { now, repeatMode, shuffle } = api;
  const media = api.currentItem?.media_item ?? null;
  const artist = media?.artists?.[0];
  const album = media?.album ?? null;
  const [infoOpen, setInfoOpen] = useStorage<boolean>("info_open", false);
  const [moreOpen, setMoreOpen] = useState(false);
  const fav = media ? api.favorites.has(media.uri) : false;
  // The current track gets the same action set as a row (C2) — minus the two
  // that make no sense for what's already playing, and favourite (its own btn).
  const moreActions = media
    ? standardActions(api, media).filter(
        (a) => !["Play next", "Add to queue", "Favourite", "Remove favourite"].includes(a.label),
      )
    : [];

  return (
    <div className="flex flex-col gap-3 border-border border-b p-3">
      <div className="flex gap-3">
        <button
          type="button"
          data-no-drag
          aria-label={album ? `Go to album ${album.name}` : "Artwork"}
          disabled={!album?.uri && !album?.item_id}
          onClick={() =>
            album &&
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
          className="w-[clamp(3.5rem,22cqw,7rem)] shrink-0 enabled:hover:opacity-90 disabled:cursor-default"
        >
          <Artwork url={now?.artworkUrl ?? null} radio={!!now?.isRadio} />
        </button>

        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <p className="music-serif line-clamp-2 text-[clamp(15px,4cqw,22px)] leading-[1.15] text-foreground">
            {now?.title ?? "Nothing playing"}
          </p>
          <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
            {now?.isRadio ? (
              "Live radio"
            ) : artist && (artist.uri || artist.item_id) ? (
              <button
                type="button"
                data-no-drag
                onClick={() =>
                  api.navTo({
                    kind: "artist",
                    item: {
                      item_id: artist.item_id ?? "",
                      provider: artist.provider ?? media?.provider ?? "",
                      name: artist.name,
                      uri: artist.uri ?? "",
                      media_type: "artist",
                    },
                  })
                }
                className="truncate hover:text-foreground hover:underline"
              >
                {now?.subtitle}
              </button>
            ) : (
              now?.subtitle || (now ? "" : "Search to start")
            )}
          </p>
        </div>
      </div>

      <Scrubber api={api} />

      <div className="flex flex-wrap items-center justify-between gap-y-2">
        <div className="flex items-center gap-1">
          <IconBtn
            label="Previous track"
            tap
            pending={api.pending.has("previous")}
            disabled={api.pending.has("previous")}
            onClick={api.previous}
          >
            <SkipBack className="size-4" fill="currentColor" />
          </IconBtn>
          <IconBtn
            label={now?.playing ? "Pause" : "Play"}
            primary
            tap
            pending={api.pending.has("playPause")}
            disabled={api.pending.has("playPause")}
            onClick={() => {
              api.unlock();
              api.playPause();
            }}
          >
            {now?.playing ? (
              <Pause className="size-4" fill="currentColor" />
            ) : (
              <Play className="size-4 translate-x-px" fill="currentColor" />
            )}
          </IconBtn>
          <IconBtn
            label="Next track"
            tap
            pending={api.pending.has("next")}
            disabled={api.pending.has("next")}
            onClick={api.next}
          >
            <SkipForward className="size-4" fill="currentColor" />
          </IconBtn>
        </div>

        <div className="flex items-center gap-1">
          <IconBtn
            label={
              api.queueMode === "replace"
                ? "Clicking a track replaces the queue — switch to add"
                : "Clicking a track adds to the queue — switch to replace"
            }
            active={api.queueMode === "append"}
            onClick={() => api.setQueueMode(api.queueMode === "replace" ? "append" : "replace")}
          >
            {api.queueMode === "replace" ? (
              <Replace className="size-3.5" />
            ) : (
              <ListPlus className="size-3.5" />
            )}
          </IconBtn>
          <IconBtn
            label={`Shuffle ${shuffle ? "on" : "off"}`}
            active={shuffle}
            onClick={api.toggleShuffle}
          >
            <Shuffle className="size-3.5" />
          </IconBtn>
          <IconBtn
            label={`Repeat ${repeatMode}`}
            active={repeatMode !== "off"}
            onClick={api.cycleRepeat}
          >
            {repeatMode === "one" ? <Repeat1 className="size-3.5" /> : <Repeat className="size-3.5" />}
          </IconBtn>
          <IconBtn
            label={infoOpen ? "Hide track details" : "Track details"}
            active={infoOpen}
            onClick={() => setInfoOpen(!infoOpen)}
          >
            <Info className="size-3.5" />
          </IconBtn>
          {media && (
            <>
              <IconBtn
                label={fav ? "Remove favourite" : "Favourite"}
                active={fav}
                onClick={() => api.toggleFavorite(media)}
              >
                <Heart className={cn("size-3.5", fav && "fill-current")} />
              </IconBtn>
              <IconBtn label="More actions" active={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
                <Ellipsis className="size-3.5" />
              </IconBtn>
            </>
          )}
          <VolumeControl api={api} />
        </div>
      </div>

      {moreOpen && media && (
        <div className="border-border border-t pt-1">
          <RowActionPanel
            actions={moreActions}
            onClose={() => setMoreOpen(false)}
            className="px-0 pb-0"
          />
        </div>
      )}

      {infoOpen && (
        <div className="border-border border-t pt-1.5">
          <TrackInfo api={api} />
        </div>
      )}
    </div>
  );
};
