// ── actions: transport + search ──────────────────────────────────────────
// Play/pause/skip/seek/repeat/shuffle/speed + search. These predict ahead of
// the server (optimistic UI) via the shared `optimisticRef`/`markPending`
// (owned by useConnection) so a control never visibly snaps back mid-command
// — see useConnection's doc comment for why that machinery stays merged with
// `refreshQueue` instead of living here too.
import { useCallback, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useStorage } from "@/wigl/hooks";
import type { MaClient } from "../maClient";
import { KEYS, SEARCH_LIMIT, SEARCH_MEDIA_TYPES } from "../music.config";
import type { MediaImage, MediaItem, NavView, NowPlaying, QueueItem, RepeatMode, SearchResults } from "../types";
import type { OptimisticState, PlayOption, QueueMode } from "./types";

const EMPTY_RESULTS: SearchResults = {
  artists: [],
  albums: [],
  tracks: [],
  playlists: [],
  radio: [],
  podcasts: [],
  audiobooks: [],
};

/** MA QueueOption for each widget-level intent. `"play"` inserts after the
 * current item and skips to it, keeping history + tail intact — the
 * non-destructive "play now". `"replace"` wipes the queue. `"add"` appends to
 * the tail. Only the explicit Clear button (or a Replace) empties a queue. */
const MA_OPTION: Record<PlayOption, string> = {
  play: "play",
  replace: "replace",
  next: "next",
  add: "add",
};

const REPEAT_CYCLE: RepeatMode[] = ["off", "all", "one"];

// After a local seek the SDK's live clock (`trackProgress`) keeps reporting
// the pre-seek position for a second or more while the server rebuffers and
// pushes a fresh sync frame (P0.3 — a fixed 1.5 s freeze expired mid-rebuffer
// and the scrubber snapped back to the old time). Instead: hold a projected
// playhead (target + real time elapsed since the seek) and only hand back to
// the SDK clock once it has actually caught up to within `SEEK_CONVERGE_S`
// (useConnection's `getProgress`), or after `SEEK_FREEZE_MAX_MS` as a hard
// stop for a stalled rebuffer.
const SEEK_FREEZE_MAX_MS = 10_000;

export const useTransportActions = ({
  clientRef,
  queueIdRef,
  cmd,
  markPending,
  imageUrl,
  nowRef,
  upNextRef,
  optimisticRef,
  seekFreezeRef,
  playbackSpeedRef,
  speedSetAtRef,
  providersRef,
  setNow,
  setCurrentItem,
  setUpNext,
  setRepeatMode,
  setShuffle,
  setPlaybackSpeedState,
  setNavStack,
  repeatMode,
  shuffle,
}: {
  clientRef: MutableRefObject<MaClient | null>;
  queueIdRef: MutableRefObject<string | null>;
  cmd: (command: string, args?: Record<string, unknown>) => void;
  markPending: (action: string) => void;
  imageUrl: (img?: MediaImage | null) => string | null;
  nowRef: MutableRefObject<NowPlaying | null>;
  upNextRef: MutableRefObject<QueueItem[]>;
  optimisticRef: MutableRefObject<OptimisticState>;
  seekFreezeRef: MutableRefObject<{ target: number; at: number; maxUntil: number } | null>;
  playbackSpeedRef: MutableRefObject<number>;
  speedSetAtRef: MutableRefObject<number>;
  providersRef: MutableRefObject<string[]>;
  setNow: Dispatch<SetStateAction<NowPlaying | null>>;
  setCurrentItem: Dispatch<SetStateAction<QueueItem | null>>;
  setUpNext: Dispatch<SetStateAction<QueueItem[]>>;
  setRepeatMode: Dispatch<SetStateAction<RepeatMode>>;
  setShuffle: Dispatch<SetStateAction<boolean>>;
  setPlaybackSpeedState: Dispatch<SetStateAction<number>>;
  setNavStack: Dispatch<SetStateAction<NavView[]>>;
  repeatMode: RepeatMode;
  shuffle: boolean;
}) => {
  const [queueMode, setQueueMode] = useStorage<QueueMode>(KEYS.queueMode, "append");
  const [providerFilter] = useStorage<string>(KEYS.providerFilter, "");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  // Bumped on every new search() call; a slow provider response for an older
  // generation is dropped instead of overwriting fresher results.
  const searchGenRef = useRef(0);

  /** Per-provider parallel search with progressive merge (backlog B1/B2).
   * RadioBrowser fills in ~0.5 s, YouTube ~1–3 s — the user sees results as
   * each provider answers instead of one 4 s blank. Previous results stay on
   * screen until the first new response lands; a re-search cancels stale
   * in-flight responses via the generation counter. */
  const search = useCallback(
    (query: string, opts?: { mediaTypes?: string[]; providers?: string[] }) => {
      const client = clientRef.current;
      const q = query.trim();
      if (!client || !q) {
        searchGenRef.current += 1;
        setResults(null);
        setSearching(false);
        return;
      }
      const gen = ++searchGenRef.current;
      const types = opts?.mediaTypes?.length ? opts.mediaTypes : [...SEARCH_MEDIA_TYPES];
      const explicit = opts?.providers?.length
        ? opts.providers
        : providerFilter
          ? [providerFilter]
          : null;
      // Fan out over each enabled provider + the library; fall back to one
      // all-provider call if the provider list hasn't loaded yet.
      const targets: (string | null)[] =
        explicit ?? (providersRef.current.length ? [...providersRef.current, "library"] : [null]);

      setSearching(true);
      const acc: SearchResults = { ...EMPTY_RESULTS };
      let remaining = targets.length;

      for (const p of targets) {
        client
          .command<SearchResults>("music/search", {
            search_query: q,
            media_types: types,
            limit: SEARCH_LIMIT,
            ...(p ? { providers: [p] } : {}),
          })
          .then((r) => {
            if (searchGenRef.current !== gen || !r) return;
            for (const key of Object.keys(acc) as (keyof SearchResults)[]) {
              const seen = new Set(acc[key].map((i) => i.uri));
              acc[key] = [...acc[key], ...(r[key] ?? []).filter((i) => i.uri && !seen.has(i.uri))];
            }
            setResults({ ...acc });
          })
          .catch((e) => console.warn("[music] search", p, e))
          .finally(() => {
            if (searchGenRef.current !== gen) return;
            remaining -= 1;
            if (remaining <= 0) setSearching(false);
          });
      }
    },
    [clientRef, providerFilter, providersRef],
  );

  /** A plain call (no `option`) ALWAYS starts the item playing now. The D1
   * queue-mode toggle only decides whether the existing tail survives:
   * `"append"` → `"play"` (insert after current + skip, tail intact),
   * `"replace"` → wipe + play. An empty queue always replaces. Silent-append
   * without playing is the explicit `"add"` option only (a `⋯` action), never
   * the default gesture. `play()` never touches `results` / `navStack` — the
   * pane, scroll position and search stay exactly as they were (P0.2). */
  const play = useCallback(
    (item: MediaItem, option?: PlayOption) => {
      const opt: PlayOption =
        option ?? (queueMode === "replace" || !nowRef.current ? "replace" : "play");
      cmd("player_queues/play_media", { media: item.uri, option: MA_OPTION[opt] });
      if (opt === "play" || opt === "replace") {
        markPending("play");
        const o = optimisticRef.current;
        o.holdNow = true;
        o.expectId = item.uri;
        setCurrentItem(null);
        setNow({
          title: item.name,
          subtitle: item.artists?.map((a) => a.name).join(", ") ?? item.album?.name ?? "",
          artworkUrl: imageUrl(item.image ?? item.metadata?.images?.[0] ?? null),
          elapsed: 0,
          duration: item.duration ?? 0,
          playing: true,
          isRadio: item.media_type === "radio",
        });
      }
    },
    [cmd, markPending, queueMode, imageUrl, nowRef, optimisticRef, setCurrentItem, setNow],
  );

  const playPause = useCallback(() => {
    const playing = !!nowRef.current?.playing;
    optimisticRef.current.playing = !playing;
    setNow((n) => (n ? { ...n, playing: !playing } : n));
    markPending("playPause");
    cmd(playing ? "player_queues/pause" : "player_queues/play");
  }, [cmd, markPending, nowRef, optimisticRef, setNow]);

  const next = useCallback(() => {
    markPending("next");
    // Predict the jump from the known up-next head so the panel doesn't sit on
    // the old track for a full Docker round-trip. Held until the server's
    // current item is this one (P1.1).
    const head = upNextRef.current[0];
    if (head) {
      const m = head.media_item ?? null;
      const isRadio = m?.media_type === "radio";
      const o = optimisticRef.current;
      o.holdNow = true;
      o.expectId = head.queue_item_id;
      setCurrentItem(head);
      setNow(() => ({
        title: m?.name ?? head.name ?? "—",
        subtitle: isRadio
          ? "Live radio"
          : (m?.artists?.map((a) => a.name).join(", ") ?? m?.album?.name ?? ""),
        artworkUrl: imageUrl(head.image ?? m?.metadata?.images?.[0] ?? null),
        elapsed: 0,
        duration: head.duration ?? m?.duration ?? 0,
        playing: true,
        isRadio,
      }));
      setUpNext((list) => list.slice(1));
    }
    cmd("player_queues/next");
  }, [cmd, markPending, imageUrl, upNextRef, optimisticRef, setCurrentItem, setNow, setUpNext]);

  const previous = useCallback(() => {
    markPending("previous");
    // No known target to hold against; the confirming player event replaces
    // `now` wholesale. Just reset the clock so the scrubber snaps to 0.
    setNow((n) => (n ? { ...n, elapsed: 0 } : n));
    cmd("player_queues/previous");
  }, [cmd, markPending, setNow]);

  // I — "radio" is MA's `radio_playlist` provider: a dynamic playlist (seed's
  // own tracks + similar) addressed as `radio_playlist://playlist/<seed uri>`.
  // Navigate to it (like the MA frontend does) instead of destructively
  // replacing the queue — the playlist view's Play then respects the queue-mode
  // toggle, and "Add to queue" is right there.
  const startRadio = useCallback(
    (item: MediaItem) => {
      const type = item.media_type === "album" ? "Album" : item.media_type === "playlist" ? "Playlist" : item.media_type === "artist" ? "Artist" : "Track";
      const radioItem: MediaItem = {
        item_id: item.uri,
        provider: "radio_playlist",
        uri: `radio_playlist://playlist/${item.uri}`,
        name: `${item.name} — ${type} radio`,
        media_type: "playlist",
        is_editable: false,
      };
      setNavStack((s) => [...s, { kind: "playlist", item: radioItem }]);
    },
    [setNavStack],
  );

  const seek = useCallback(
    (seconds: number) => {
      const n = nowRef.current;
      if (!n || n.isRadio) return; // nothing to seek in / a live stream (MA 500s on idle)
      const pos = Math.max(0, Math.round(seconds));
      seekFreezeRef.current = { target: pos, at: Date.now(), maxUntil: Date.now() + SEEK_FREEZE_MAX_MS };
      cmd("player_queues/seek", { position: pos });
      setNow((cur) => (cur ? { ...cur, elapsed: pos } : cur));
    },
    [cmd, nowRef, seekFreezeRef, setNow],
  );

  const cycleRepeat = useCallback(() => {
    const nextMode = REPEAT_CYCLE[(REPEAT_CYCLE.indexOf(repeatMode) + 1) % REPEAT_CYCLE.length];
    optimisticRef.current.repeat = nextMode;
    setRepeatMode(nextMode);
    markPending("repeat");
    cmd("player_queues/repeat", { repeat_mode: nextMode });
  }, [cmd, markPending, repeatMode, optimisticRef, setRepeatMode]);

  const toggleShuffle = useCallback(() => {
    const nextOn = !shuffle;
    optimisticRef.current.shuffle = nextOn;
    setShuffle(nextOn);
    markPending("shuffle");
    cmd("player_queues/shuffle", { shuffle_enabled: nextOn });
  }, [cmd, markPending, shuffle, optimisticRef, setShuffle]);

  /** P2 — server-side atempo. UI-capped at 0.5–2× (the musically useful range;
   * MA's own hard max is 3×). Optimistic; reverts if the server refuses (the
   * SETUP.md shim not applied, or a radio/unknown-duration item). */
  const setPlaybackSpeed = useCallback(
    (speed: number) => {
      const s = Math.min(2, Math.max(0.5, Math.round(speed * 20) / 20));
      const prev = playbackSpeedRef.current;
      if (s === prev) return;
      speedSetAtRef.current = Date.now();
      setPlaybackSpeedState(s);
      const client = clientRef.current;
      const queue_id = queueIdRef.current;
      if (!client || !queue_id) return;
      client
        .command("player_queues/set_playback_speed", { queue_id, speed: s })
        .catch((e) => {
          console.warn("[music] set_playback_speed", e);
          speedSetAtRef.current = 0;
          setPlaybackSpeedState(prev);
        });
    },
    [clientRef, queueIdRef, playbackSpeedRef, speedSetAtRef, setPlaybackSpeedState],
  );

  return {
    queueMode,
    setQueueMode,
    results,
    searching,
    search,
    clearResults: () => setResults(null),
    play,
    startRadio,
    playPause,
    next,
    previous,
    seek,
    clearQueue: () => cmd("player_queues/clear"),
    cycleRepeat,
    toggleShuffle,
    setPlaybackSpeed,
  };
};
