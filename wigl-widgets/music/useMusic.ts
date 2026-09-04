// Data flow (docs/architecture.md → "Data flow pattern"): settings → connect
// effect → two WebSockets (control + Sendspin audio) → useState → render. No
// query library for the queue/now-playing (event-driven); detail views
// (artist/album/playlist) cache their reads with @/wigl/hooks' useQuery.
// One hook, owned by index.tsx.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStorage } from "@/wigl/hooks";
import { runCmd } from "@/wigl/utils";
import { arrayMove } from "./util";
import { MaClient, type MaEndpoint } from "./maClient";
import {
  DEFAULT_PASSWORD,
  DEFAULT_USERNAME,
  KEYS,
  MA_CONTAINER,
  MA_HOST,
  MA_PORT,
  OPTIMISTIC_TIMEOUT_MS,
  QUEUE_POLL_MS,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  SEARCH_LIMIT,
  SEARCH_MEDIA_TYPES,
  SENDSPIN_OUTPUT,
} from "./music.config";
import { type AudioFx, attachAudioFx, DEFAULT_FX, type FxState, normalizeFx } from "./audioGraph";
import { connectSendspin, type SendspinHandle } from "./sendspin";
import {
  dockerState,
  maReachable,
  startDockerDesktop,
  startMaContainer,
} from "./serverProcess";
import type {
  ConnState,
  MediaImage,
  MediaItem,
  NavView,
  NowPlaying,
  PlayerQueue,
  QueueItem,
  RepeatMode,
  SearchResults,
} from "./types";

const EMPTY_RESULTS: SearchResults = {
  artists: [],
  albums: [],
  tracks: [],
  playlists: [],
  radio: [],
  podcasts: [],
  audiobooks: [],
};

export type PlayOption = "play" | "replace" | "next" | "add";
export type QueueMode = "append" | "replace";

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

// P0.3 — post-seek playhead projection. Hold the projected position until the
// SDK clock lands within this many seconds of it, or this long has passed.
const SEEK_CONVERGE_S = 1.5;
const SEEK_FREEZE_MAX_MS = 10_000;

export interface MusicApi {
  state: ConnState;
  error: string | null;
  now: NowPlaying | null;
  currentItem: QueueItem | null;
  upNext: QueueItem[];
  repeatMode: RepeatMode;
  shuffle: boolean;
  /** P2 — atempo multiplier, 0.5–2 (1 = normal). Server-side; the scrubber
   * clock already compensates via the SDK's `trackProgress`. */
  playbackSpeed: number;
  setPlaybackSpeed: (speed: number) => void;
  /** D1 — what a plain left-click on a track does (persisted). */
  queueMode: QueueMode;
  setQueueMode: (m: QueueMode) => void;
  /** F1 — playlist item_ids pinned to the Home quick-access strip. */
  pinnedPlaylists: string[];
  togglePinPlaylist: (id: string) => void;
  /** Transport actions fired but not yet confirmed by a server event
   * ("playPause" | "next" | "previous" | "play"). The triggering control
   * disables itself while its name is in here (backlog A1). */
  pending: Set<string>;
  results: SearchResults | null;
  searching: boolean;
  volume: number;
  /** The user's library playlists (editable + smart), refreshed after edits. */
  playlists: MediaItem[];
  /** Server-side recently-played items, newest first. */
  recentlyPlayed: MediaItem[];
  /** Enabled MA music-provider instance ids (e.g. "radiobrowser", "ytmusic"). */
  providers: string[];
  serverUrl: string;
  favorites: Set<string>;
  /** Browser-pane navigation. Views replace the pane; now-playing stays pinned. */
  nav: NavView;
  canBack: boolean;
  navTo: (v: NavView) => void;
  navBack: () => void;
  navHome: () => void;
  retry: () => void;
  search: (query: string, opts?: { mediaTypes?: string[]; providers?: string[] }) => void;
  clearResults: () => void;
  play: (item: MediaItem, option?: PlayOption) => void;
  startRadio: (item: MediaItem) => void;
  playPause: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  clearQueue: () => void;
  removeFromQueue: (queueItemId: string) => void;
  /** Optimistic reorder of an up-next row by `posShift` places (negative =
   * toward the front). Reconciles on the next `queue_items_updated`. */
  moveQueueItem: (queueItemId: string, posShift: number) => void;
  moveQueueItemToEnd: (queueItemId: string) => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  toggleFavorite: (item: MediaItem) => void;
  setVolume: (v: number) => void;
  /** Prime the browser audio output — call from a user gesture (first play). */
  unlock: () => void;
  /** The Sendspin SDK's live playback position (seconds) + duration, or null
   * until the server has synced track metadata. Interpolates smoothly between
   * MA's sparse `queue_time_updated` events — poll it on a tick while playing. */
  getProgress: () => { position: number; duration: number; playbackSpeed: number } | null;
  refreshPlaylists: () => void;
  refreshRecent: () => void;
  createPlaylist: (name: string) => Promise<MediaItem | null>;
  saveQueueAsPlaylist: (name: string) => Promise<MediaItem | null>;
  /** E1 — rename an editable library playlist (sticks; needs `overwrite:true`
   * and the full playlist object as `update`). No-op for smart playlists. */
  renamePlaylist: (playlist: MediaItem, name: string) => Promise<void>;
  /** E4 — append every track of `source` into playlist `targetId`. */
  mergePlaylist: (source: MediaItem, targetId: string) => Promise<void>;
  deletePlaylist: (playlist: MediaItem) => void;
  addToPlaylist: (playlistId: string, uris: string[]) => Promise<void>;
  removePlaylistTrack: (playlistId: string, position: number) => Promise<void>;
  /** P6.2 — rewrite a library playlist to `orderedUris` (drag-reorder, on drop). */
  reorderPlaylist: (playlistId: string, orderedUris: string[]) => Promise<void>;
  /** G — audio effects (4-band EQ + reverb + bypass). `fxAvailable` is false
   * in `"direct"` output mode (no `<audio>` to tap); opening the Effects tab
   * transparently switches to `"media-element"` (reconnects the player, with a
   * play-state failsafe). */
  fx: FxState;
  /** Persist + apply. Debounce this behind a drag. */
  setFx: (fx: FxState) => void;
  /** Apply to the live graph only (no persist) — use on every slider move. */
  applyFx: (fx: FxState) => void;
  fxAvailable: boolean;
  /** E3 — per-playlist custom cover/background images, `{ [item_id]: dataURI }`.
   * Resolve a playlist's display image via `playlistDisplayImage` (playlistImage.ts). */
  playlistImages: Record<string, string>;
  setPlaylistImage: (playlistId: string, dataUri: string | null) => void;
  audioOutput: "direct" | "media-element";
  setAudioOutput: (mode: "direct" | "media-element") => void;
  /** Open the Music Assistant web UI (to add a provider like YouTube Music). */
  openServer: () => void;
  /** P4 — the offline panel's recovery surface. `startServer` starts Docker if
   * needed, then the container, then reconnects. `manageServer` (also in
   * Settings) auto-runs that on any future unreachable connect. */
  startServer: () => void;
  serverStarting: boolean;
  manageServer: boolean;
  setManageServer: (v: boolean) => void;
  imageUrl: (img?: MediaImage | null) => string | null;
  /** Fire a control command that isn't queue-scoped (artist/album/playlist
   * reads). Rejects if not connected — callers wrap in useQuery. */
  request: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
}

export const useMusic = (): MusicApi => {
  const [host] = useStorage<string>(KEYS.host, MA_HOST);
  const [port] = useStorage<number>(KEYS.port, MA_PORT);
  const [username] = useStorage<string>(KEYS.username, DEFAULT_USERNAME);
  const [password] = useStorage<string>(KEYS.password, DEFAULT_PASSWORD);
  const [providerFilter] = useStorage<string>(KEYS.providerFilter, "");
  const [manageServer, setManageServer] = useStorage<boolean>(KEYS.manageServer, false);
  const [serverStarting, setServerStarting] = useState(false);
  // Read inside boot() only — toggling it must NOT tear down a live connection
  // (P0.6: doing so stopped playback). It just changes whether a *future*
  // reconnect tries to auto-start the container.
  const manageServerRef = useRef(manageServer);
  manageServerRef.current = manageServer;
  const [queueMode, setQueueMode] = useStorage<QueueMode>(KEYS.queueMode, "append");
  const [pinnedPlaylists, setPinnedPlaylists] = useStorage<string[]>(KEYS.pinnedPlaylists, []);
  const [audioOutput, setAudioOutputStored] = useStorage<"direct" | "media-element">(
    KEYS.audioOutput,
    SENDSPIN_OUTPUT,
  );
  const [fxStored, setFxStored] = useStorage<FxState>(KEYS.fx, DEFAULT_FX);
  const [playlistImages, setPlaylistImagesStored] = useStorage<Record<string, string>>(
    KEYS.playlistImages,
    {},
  );
  const playlistImagesRef = useRef(playlistImages);
  playlistImagesRef.current = playlistImages;
  const setPlaylistImage = useCallback(
    (id: string, uri: string | null) => {
      const next = { ...playlistImagesRef.current };
      if (uri) next[id] = uri;
      else delete next[id];
      setPlaylistImagesStored(next);
    },
    [setPlaylistImagesStored],
  );
  // Storage may still hold the pre-4-band `{low,mid,high,reverb,echo}` shape —
  // normalise on read so every consumer sees the current `FxState`.
  const fx = useMemo(() => normalizeFx(fxStored), [fxStored]);
  // P1.2 — the state the widget believed it was in when the current connection
  // was torn down, captured in the connect effect's cleanup. After the fresh
  // player is `ready`, `boot()` diffs it against the real server snapshot and
  // re-asserts anything that drifted — play/pause, repeat, shuffle, volume.
  // Covers any reconnect (output switch, host/port/credential edit, dropped
  // socket) and is the owner's "if something ever stops the music, it at least
  // comes back" safety net.
  const resyncRef = useRef<{
    playing: boolean;
    repeat: RepeatMode;
    shuffle: boolean;
    volume: number;
    speed: number;
  } | null>(null);
  const setAudioOutput = useCallback(
    (mode: "direct" | "media-element") => setAudioOutputStored(mode),
    [setAudioOutputStored],
  );

  const [state, setState] = useState<ConnState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<NowPlaying | null>(null);
  const [currentItem, setCurrentItem] = useState<QueueItem | null>(null);
  const [upNext, setUpNext] = useState<QueueItem[]>([]);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [shuffle, setShuffle] = useState(false);
  const [playbackSpeed, setPlaybackSpeedState] = useState(1);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [volume, setVolumeState] = useState(100);
  const [providers, setProviders] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [playlists, setPlaylists] = useState<MediaItem[]>([]);
  const [recentlyPlayed, setRecentlyPlayed] = useState<MediaItem[]>([]);
  const [navStack, setNavStack] = useState<NavView[]>([{ kind: "browse" }]);
  const [pending, setPending] = useState<Set<string>>(() => new Set());

  const clientRef = useRef<MaClient | null>(null);
  const sendspinRef = useRef<SendspinHandle | null>(null);
  const queueIdRef = useRef<string | null>(null);
  const nowRef = useRef<NowPlaying | null>(null);
  nowRef.current = now;
  const repeatRef = useRef<RepeatMode>(repeatMode);
  repeatRef.current = repeatMode;
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const playbackSpeedRef = useRef(playbackSpeed);
  playbackSpeedRef.current = playbackSpeed;
  // Ignore the server's playback_speed echo right after a local change (same
  // pattern as volume) so the badge/slider never snap mid-interaction.
  const speedSetAtRef = useRef(0);
  const upNextRef = useRef<QueueItem[]>([]);
  upNextRef.current = upNext;
  // P1.1 — fields the UI has already predicted. `refreshQueue` keeps each
  // prediction until the server's own snapshot agrees, then clears the
  // matching `pending` entry. Without this, any queue*/player* event that
  // fires before MA has processed the command (a volume echo mid-skip, a
  // position tick) makes `refreshQueue` read stale state and snap the control
  // back — the "I pressed pause and waited 3 s" bug.
  const optimisticRef = useRef<{
    playing?: boolean;
    repeat?: RepeatMode;
    shuffle?: boolean;
    /** queue_item_id or media uri we expect to become the current item */
    expectId?: string;
    /** next / previous / row-play in flight — hold now/currentItem/upNext */
    holdNow?: boolean;
    /** queue add/remove/reorder in flight — hold upNext */
    holdQueue?: boolean;
    /** hard cap on any hold, in case the confirming event never matches */
    holdUntil?: number;
  }>({});
  const providersRef = useRef<string[]>([]);
  providersRef.current = providers;
  // Bumped on every new search() call; a slow provider response for an older
  // generation is dropped instead of overwriting fresher results.
  const searchGenRef = useRef(0);
  // action → timeout handle for the not-yet-confirmed transport commands.
  const pendingRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // After a local seek the SDK's live clock (`trackProgress`) keeps reporting
  // the pre-seek position for a second or more while the server rebuffers and
  // pushes a fresh sync frame (P0.3 — a fixed 1.5 s freeze expired mid-rebuffer
  // and the scrubber snapped back to the old time). Instead: hold a projected
  // playhead (target + real time elapsed since the seek) and only hand back to
  // the SDK clock once it has actually caught up to within `SEEK_CONVERGE_S`,
  // or after `SEEK_FREEZE_MAX_MS` as a hard stop for a stalled rebuffer.
  const seekFreezeRef = useRef<{ target: number; at: number; maxUntil: number } | null>(null);
  // Ignore SDK volume echoes right after a local drag so the slider never snaps.
  const volumeSetAtRef = useRef(0);
  // G1 — the Web Audio FX graph, alive for the connection lifetime.
  const fxRef = useRef<AudioFx | null>(null);
  const fxValRef = useRef<FxState>(fx);
  fxValRef.current = fx;
  const httpBase = `http://${host}:${port}`;

  const nav = navStack[navStack.length - 1] ?? { kind: "browse" };
  const navTo = useCallback((v: NavView) => {
    setNavStack((s) => (v.kind === "browse" ? [{ kind: "browse" }] : [...s, v]));
  }, []);
  const navBack = useCallback(() => setNavStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const navHome = useCallback(() => setNavStack([{ kind: "browse" }]), []);

  const imageUrl = useCallback(
    (img?: MediaImage | null): string | null => {
      if (!img) return null;
      if (img.proxy_id) return `${httpBase}/imageproxy/${img.proxy_id}`;
      return img.remotely_accessible ? img.path : null;
    },
    [httpBase],
  );

  const request = useCallback(<T = unknown>(command: string, args: Record<string, unknown> = {}) => {
    const client = clientRef.current;
    if (!client) return Promise.reject(new Error("not connected")) as Promise<T>;
    return client.command<T>(command, args);
  }, []);

  const refreshPlaylists = useCallback(() => {
    clientRef.current
      ?.command<MediaItem[]>("music/playlists/library_items")
      .then((p) => setPlaylists(Array.isArray(p) ? p : []))
      .catch((e) => console.warn("[music] playlists", e));
  }, []);

  const refreshRecent = useCallback(() => {
    clientRef.current
      ?.command<MediaItem[]>("music/recently_played_items", { limit: 50 })
      .then((r) => setRecentlyPlayed(Array.isArray(r) ? r : []))
      .catch((e) => console.warn("[music] recent", e));
  }, []);

  // ── optimism: predict now, reconcile on the confirming event ─────────────
  const syncPending = useCallback(() => setPending(new Set(pendingRef.current.keys())), []);

  /** Clear one in-flight action (its timeout + the `pending` badge). */
  const pendingClear = useCallback(
    (action: string) => {
      const t = pendingRef.current.get(action);
      if (!t) return;
      clearTimeout(t);
      pendingRef.current.delete(action);
      syncPending();
    },
    [syncPending],
  );

  // ── snapshot the queue → now-playing + up-next ───────────────────────────
  const refreshQueue = useCallback(async () => {
    const client = clientRef.current;
    const queueId = queueIdRef.current;
    if (!client || !queueId) return;
    try {
      const q = await client.command<PlayerQueue>("player_queues/get", { queue_id: queueId });
      if (!q) return;
      const o = optimisticRef.current;
      const holdExpired = !o.holdUntil || Date.now() > o.holdUntil;

      // repeat / shuffle — apply the server value unless we're still holding a
      // prediction the server hasn't confirmed yet.
      let repeat = (q.repeat_mode as RepeatMode) ?? "off";
      if (o.repeat !== undefined) {
        if (o.repeat === repeat || holdExpired) {
          o.repeat = undefined;
          pendingClear("repeat");
        } else repeat = o.repeat;
      }
      setRepeatMode(repeat);

      let shuffle = !!q.shuffle_enabled;
      if (o.shuffle !== undefined) {
        if (o.shuffle === shuffle || holdExpired) {
          o.shuffle = undefined;
          pendingClear("shuffle");
        } else shuffle = o.shuffle;
      }
      setShuffle(shuffle);

      const cur = q.current_item ?? null;
      if (Date.now() - speedSetAtRef.current > 1500) {
        setPlaybackSpeedState(
          Number(q.playback_speed ?? cur?.extra_attributes?.playback_speed) || 1,
        );
      }

      const media = cur?.media_item ?? null;

      // track-change prediction (next / previous / row-play). Keep the predicted
      // now/currentItem/upNext until the server's current item is the one we
      // expect (or the hold cap lapses).
      if (o.holdNow) {
        const matched =
          o.expectId != null &&
          (o.expectId === cur?.queue_item_id || o.expectId === media?.uri);
        if (matched || holdExpired) {
          o.holdNow = false;
          o.expectId = undefined;
          pendingClear("next");
          pendingClear("previous");
          pendingClear("play");
        } else {
          return; // repeat/shuffle above were safe; the rest waits
        }
      }

      setCurrentItem(cur);
      const isRadio = media?.media_type === "radio";

      let playing = q.state === "playing";
      if (o.playing !== undefined) {
        if (o.playing === playing || holdExpired) {
          o.playing = undefined;
          pendingClear("playPause");
        } else playing = o.playing;
      }

      setNow(
        cur
          ? {
              title: media?.name ?? cur.name ?? "—",
              subtitle: isRadio
                ? "Live radio"
                : (media?.artists?.map((a) => a.name).join(", ") ?? media?.album?.name ?? ""),
              artworkUrl: imageUrl(cur.image ?? media?.metadata?.images?.[0] ?? null),
              elapsed: q.elapsed_time ?? 0,
              duration: cur.duration ?? media?.duration ?? 0,
              playing,
              isRadio,
            }
          : null,
      );

      // `previous` carries no held field — any reconcile confirms it.
      pendingClear("previous");

      if (o.holdQueue && !holdExpired) return; // keep the optimistic upNext
      o.holdQueue = false;
      pendingClear("queueEdit");
      if (q.items > 1) {
        const items = await client.command<QueueItem[]>("player_queues/items", {
          queue_id: queueId,
          limit: 50,
        });
        const currentId = cur?.queue_item_id;
        const idx = items.findIndex((i) => i.queue_item_id === currentId);
        setUpNext(idx >= 0 ? items.slice(idx + 1) : items);
      } else {
        setUpNext([]);
      }
    } catch (e) {
      console.warn("[music] refreshQueue", e);
    }
  }, [imageUrl, pendingClear]);

  const clearAllPending = useCallback(() => {
    if (pendingRef.current.size === 0) return;
    for (const t of pendingRef.current.values()) clearTimeout(t);
    pendingRef.current.clear();
    syncPending();
  }, [syncPending]);

  /** Mark an action in flight: the triggering control shows `.mx-pending` and
   * may disable itself. If no confirming event reconciles it within
   * `OPTIMISTIC_TIMEOUT_MS`, drop the prediction and trust the server. */
  const markPending = useCallback(
    (action: string) => {
      const prev = pendingRef.current.get(action);
      if (prev) clearTimeout(prev);
      const o = optimisticRef.current;
      o.holdUntil = Date.now() + OPTIMISTIC_TIMEOUT_MS;
      pendingRef.current.set(
        action,
        setTimeout(() => {
          pendingRef.current.delete(action);
          if (action === "playPause") o.playing = undefined;
          else if (action === "repeat") o.repeat = undefined;
          else if (action === "shuffle") o.shuffle = undefined;
          else if (action === "queueEdit") o.holdQueue = false;
          else if (action === "next" || action === "previous" || action === "play") {
            o.holdNow = false;
            o.expectId = undefined;
          }
          syncPending();
          void refreshQueue();
        }, OPTIMISTIC_TIMEOUT_MS),
      );
      syncPending();
    },
    [refreshQueue, syncPending],
  );

  // Component-lifetime cleanup for any in-flight optimism timers.
  useEffect(() => () => clearAllPending(), [clearAllPending]);

  // ── connect: control WS + Sendspin audio WS ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let backoff = RECONNECT_MIN_MS;
    const endpoint: MaEndpoint = { host, port, username, password };

    const scheduleReconnect = () => {
      if (cancelled) return;
      // A dropped live connection goes back to "connecting" while it retries;
      // an "offline" state (boot() couldn't reach the server at all) stays
      // "offline" through the backoff so the OfflinePanel actually shows
      // instead of flickering to "connecting" for the whole retry wait.
      setState((s) => (s === "offline" ? s : "connecting"));
      reconnectTimer = setTimeout(() => setAttempt((n) => n + 1), backoff);
      backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
    };

    const teardown = () => {
      fxRef.current?.dispose();
      fxRef.current = null;
      sendspinRef.current?.disconnect();
      sendspinRef.current = null;
      clientRef.current?.close();
      clientRef.current = null;
      queueIdRef.current = null;
    };

    const boot = async () => {
      setError(null);
      setState("connecting");
      try {
        if (!(await maReachable(httpBase))) {
          if (manageServerRef.current) await startMaContainer(MA_CONTAINER);
          // give it a moment whether or not we started it
          for (let i = 0; i < 8 && !(await maReachable(httpBase)); i++) {
            await new Promise((r) => setTimeout(r, 1500));
          }
          if (!(await maReachable(httpBase))) {
            throw new Error(`Music Assistant isn't reachable at ${host}:${port}`);
          }
        }

        const client = new MaClient(endpoint, () => {
          if (cancelled) return;
          teardown();
          scheduleReconnect();
        });
        await client.connect();
        if (cancelled) return client.close();
        clientRef.current = client;

        const audio = await connectSendspin({
          host,
          port,
          token: client.authToken,
          clientName: "wigl",
          output: audioOutput,
          pair: (t) => client.command("sendspin/pair_web_player", { pairing_token: t }),
          onState: (s) => {
            if (Date.now() - volumeSetAtRef.current > 600) setVolumeState(s.volume);
            if (s.errored) setError("The web player reported an audio error.");
          },
          onDrop: () => {
            if (cancelled) return;
            teardown();
            scheduleReconnect();
          },
        });
        if (cancelled) return audio.disconnect();
        sendspinRef.current = audio;
        queueIdRef.current = audio.playerId;

        // G1 — in media-element mode we have an <audio> to tap. Route it
        // through the Web Audio FX chain (EQ / reverb / echo). `direct` mode
        // has no element, so the FX tab stays disabled.
        if (audio.audioElement) {
          try {
            fxRef.current = attachAudioFx(audio.audioElement);
            fxRef.current.apply(fxValRef.current);
          } catch (e) {
            console.warn("[music] audio FX unavailable", e);
          }
        }

        client.onEvent((ev) => {
          if (ev.object_id && ev.object_id !== audio.playerId) return;
          if (ev.event === "queue_time_updated" && typeof ev.data === "number") {
            setNow((n) => (n ? { ...n, elapsed: ev.data as number } : n));
          } else if (ev.event.startsWith("queue") || ev.event.startsWith("player")) {
            // Reconcile from the server snapshot. `refreshQueue` clears each
            // `pending` entry only once the server value actually matches the
            // prediction (P1.1) — a premature event no longer snaps controls.
            void refreshQueue();
          }
        });

        backoff = RECONNECT_MIN_MS;
        setState("ready");
        void refreshQueue();
        refreshPlaylists();
        refreshRecent();

        // P1.2 — re-assert everything the widget believed before this reconnect
        // that the fresh server snapshot now contradicts. `resyncRef` was set
        // in the previous effect's cleanup.
        if (resyncRef.current != null) {
          const want = resyncRef.current;
          resyncRef.current = null;
          window.setTimeout(async () => {
            if (cancelled || sendspinRef.current !== audio) return;
            const client2 = clientRef.current;
            if (!client2) return;
            const q = await client2
              .command<PlayerQueue>("player_queues/get", { queue_id: audio.playerId })
              .catch(() => null);
            if (!q) return;
            if (want.playing && q.state !== "playing") {
              audio.unlock().catch(() => {});
              cmd("player_queues/play");
            } else if (!want.playing && q.state === "playing") {
              cmd("player_queues/pause");
            }
            if (want.repeat !== ((q.repeat_mode as RepeatMode) ?? "off"))
              cmd("player_queues/repeat", { repeat_mode: want.repeat });
            if (want.shuffle !== !!q.shuffle_enabled)
              cmd("player_queues/shuffle", { shuffle_enabled: want.shuffle });
            // atempo lives in the queue item's in-memory extra_attributes — a
            // reconnect or track change drops it. Re-assert if it was non-1×.
            if (want.speed !== 1 && (Number(q.playback_speed) || 1) === 1) {
              speedSetAtRef.current = Date.now();
              cmd("player_queues/set_playback_speed", { speed: want.speed });
            }
            // The fresh player defaults its own volume; restore the user's.
            audio.setVolume(want.volume);
          }, 1200);
        }

        client
          .command<{ domain: string; instance_id: string; type: string; enabled: boolean }[]>(
            "config/providers",
          )
          .then((all) =>
            setProviders(
              (all ?? [])
                .filter((p) => p.type === "music" && p.enabled)
                .map((p) => p.instance_id),
            ),
          )
          .catch(() => {});
      } catch (e) {
        if (cancelled) return;
        teardown();
        setError(e instanceof Error ? e.message : String(e));
        setState("offline");
        scheduleReconnect();
      }
    };

    void boot();
    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      // P1.2 — carry the believed state across the teardown so the next boot()
      // re-asserts whatever drifted once the new player is "ready". Runs before
      // every effect re-run (settings edit or reconnect) and on unmount.
      resyncRef.current = nowRef.current
        ? {
            playing: !!nowRef.current.playing,
            repeat: repeatRef.current,
            shuffle: shuffleRef.current,
            volume: volumeRef.current,
            speed: playbackSpeedRef.current,
          }
        : null;
      teardown();
    };
  }, [
    host, port, username, password, httpBase, attempt, refreshQueue, refreshPlaylists,
    refreshRecent, audioOutput,
  ]);

  // ── backstop poll for missed events ─────────────────────────────────────
  useEffect(() => {
    if (state !== "ready") return;
    const id = setInterval(() => void refreshQueue(), QUEUE_POLL_MS);
    return () => clearInterval(id);
  }, [state, refreshQueue]);

  // ── G — FX: `applyFx` hits the live graph every move (cheap, ramped in
  // audioGraph); `setFx` also persists and should be debounced by the caller
  // so a drag doesn't round-trip through storage and fight the slider. ──────
  const applyFx = useCallback((next: FxState) => {
    fxRef.current?.apply(next);
  }, []);
  const setFx = useCallback(
    (next: FxState) => {
      setFxStored(next);
      fxRef.current?.apply(next);
    },
    [setFxStored],
  );

  // ── actions ────────────────────────────────────────────────────────────
  const cmd = useCallback((command: string, args: Record<string, unknown> = {}) => {
    const client = clientRef.current;
    const queue_id = queueIdRef.current;
    if (!client || !queue_id) return;
    client.command(command, { queue_id, ...args }).catch((e) => console.warn(`[music] ${command}`, e));
  }, []);

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
    [providerFilter],
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
    [cmd, markPending, queueMode, imageUrl],
  );

  const playPause = useCallback(() => {
    const playing = !!nowRef.current?.playing;
    optimisticRef.current.playing = !playing;
    setNow((n) => (n ? { ...n, playing: !playing } : n));
    markPending("playPause");
    cmd(playing ? "player_queues/pause" : "player_queues/play");
  }, [cmd, markPending]);

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
  }, [cmd, markPending, imageUrl]);

  const previous = useCallback(() => {
    markPending("previous");
    // No known target to hold against; the confirming player event replaces
    // `now` wholesale. Just reset the clock so the scrubber snaps to 0.
    setNow((n) => (n ? { ...n, elapsed: 0 } : n));
    cmd("player_queues/previous");
  }, [cmd, markPending]);

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
    [],
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
    [cmd],
  );

  const cycleRepeat = useCallback(() => {
    const nextMode = REPEAT_CYCLE[(REPEAT_CYCLE.indexOf(repeatMode) + 1) % REPEAT_CYCLE.length];
    optimisticRef.current.repeat = nextMode;
    setRepeatMode(nextMode);
    markPending("repeat");
    cmd("player_queues/repeat", { repeat_mode: nextMode });
  }, [cmd, markPending, repeatMode]);

  const toggleShuffle = useCallback(() => {
    const nextOn = !shuffle;
    optimisticRef.current.shuffle = nextOn;
    setShuffle(nextOn);
    markPending("shuffle");
    cmd("player_queues/shuffle", { shuffle_enabled: nextOn });
  }, [cmd, markPending, shuffle]);

  /** P2 — server-side atempo. UI-capped at 0.5–2× (the musically useful range;
   * MA's own hard max is 3×). Optimistic; reverts if the server refuses (the
   * SETUP.md shim not applied, or a radio/unknown-duration item). */
  const setPlaybackSpeed = useCallback((speed: number) => {
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
  }, []);

  /** Any queue edit (remove / reorder) — hold the optimistic `upNext` until the
   * `queue_items_updated` reconcile so it doesn't flicker back mid-command. */
  const holdQueueEdit = useCallback(() => {
    optimisticRef.current.holdQueue = true;
    markPending("queueEdit");
  }, [markPending]);

  const removeFromQueue = useCallback(
    (queueItemId: string) => {
      setUpNext((list) => list.filter((i) => i.queue_item_id !== queueItemId));
      holdQueueEdit();
      cmd("player_queues/delete_item", { item_id_or_index: queueItemId });
    },
    [cmd, holdQueueEdit],
  );

  const moveQueueItem = useCallback(
    (queueItemId: string, posShift: number) => {
      if (!posShift) return;
      setUpNext((list) =>
        arrayMove(
          list,
          list.findIndex((i) => i.queue_item_id === queueItemId),
          posShift,
        ),
      );
      holdQueueEdit();
      cmd("player_queues/move_item", { queue_item_id: queueItemId, pos_shift: posShift });
    },
    [cmd, holdQueueEdit],
  );

  const moveQueueItemToEnd = useCallback(
    (queueItemId: string) => {
      setUpNext((list) => {
        const from = list.findIndex((i) => i.queue_item_id === queueItemId);
        if (from < 0 || from === list.length - 1) return list;
        const copy = [...list];
        const [it] = copy.splice(from, 1);
        copy.push(it);
        return copy;
      });
      holdQueueEdit();
      cmd("player_queues/move_item_end", { queue_item_id: queueItemId });
    },
    [cmd, holdQueueEdit],
  );

  const toggleFavorite = useCallback(
    (item: MediaItem) => {
      const client = clientRef.current;
      if (!client) return;
      const on = favorites.has(item.uri);
      setFavorites((s) => {
        const n = new Set(s);
        if (on) n.delete(item.uri);
        else n.add(item.uri);
        return n;
      });
      if (on) {
        client
          .command<{ media_type?: string; item_id?: string }>("music/item_by_uri", { uri: item.uri })
          .then((lib) => {
            if (lib?.item_id && lib.media_type)
              return client.command("music/favorites/remove_item", {
                media_type: lib.media_type,
                library_item_id: lib.item_id,
              });
          })
          .catch((e) => console.warn("[music] unfavourite", e));
      } else {
        client
          .command("music/favorites/add_item", { item: item.uri })
          .catch((e) => console.warn("[music] favourite", e));
      }
    },
    [favorites],
  );

  const createPlaylist = useCallback(
    async (name: string): Promise<MediaItem | null> => {
      const client = clientRef.current;
      if (!client || !name.trim()) return null;
      try {
        const pl = await client.command<MediaItem>("music/playlists/create_playlist", { name: name.trim() });
        refreshPlaylists();
        return pl ?? null;
      } catch (e) {
        console.warn("[music] createPlaylist", e);
        return null;
      }
    },
    [refreshPlaylists],
  );

  const deletePlaylist = useCallback(
    (playlist: MediaItem) => {
      setPlaylists((list) => list.filter((p) => p.item_id !== playlist.item_id));
      clientRef.current
        ?.command("music/library/remove_item", {
          media_type: "playlist",
          library_item_id: playlist.item_id,
        })
        .then(() => refreshPlaylists())
        .catch((e) => console.warn("[music] deletePlaylist", e));
    },
    [refreshPlaylists],
  );

  const addToPlaylist = useCallback(async (playlistId: string, uris: string[]) => {
    const client = clientRef.current;
    if (!client || uris.length === 0) return;
    await client
      .command("music/playlists/add_playlist_tracks", { db_playlist_id: playlistId, uris })
      .catch((e) => console.warn("[music] addToPlaylist", e));
  }, []);

  /** D2 — copy the current queue into a fresh editable playlist. Does NOT
   * clear the queue. Returns the new playlist (or null). */
  const saveQueueAsPlaylist = useCallback(
    async (name: string): Promise<MediaItem | null> => {
      const client = clientRef.current;
      const queueId = queueIdRef.current;
      if (!client || !queueId) return null;
      try {
        const items = await client.command<QueueItem[]>("player_queues/items", {
          queue_id: queueId,
          limit: 500,
        });
        const uris = (items ?? [])
          .map((i) => i.media_item?.uri)
          .filter((u): u is string => !!u && !u.startsWith("queue:"));
        if (uris.length === 0) return null;
        const pl = await client.command<MediaItem>("music/playlists/create_playlist", {
          name: name.trim() || `queue ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
        });
        if (pl?.item_id) {
          await client.command("music/playlists/add_playlist_tracks", {
            db_playlist_id: pl.item_id,
            uris,
          });
        }
        refreshPlaylists();
        return pl ?? null;
      } catch (e) {
        console.warn("[music] saveQueueAsPlaylist", e);
        return null;
      }
    },
    [refreshPlaylists],
  );

  const renamePlaylist = useCallback(
    async (playlist: MediaItem, name: string) => {
      const client = clientRef.current;
      const next = name.trim();
      if (!client || !next || playlist.is_editable === false || next === playlist.name) return;
      setPlaylists((list) =>
        list.map((p) => (p.item_id === playlist.item_id ? { ...p, name: next } : p)),
      );
      try {
        await client.command("music/playlists/update", {
          item_id: playlist.item_id,
          update: { ...playlist, name: next },
          overwrite: true,
        });
      } catch (e) {
        console.warn("[music] renamePlaylist", e);
      }
      refreshPlaylists();
    },
    [refreshPlaylists],
  );

  const mergePlaylist = useCallback(async (source: MediaItem, targetId: string) => {
    const client = clientRef.current;
    if (!client || !targetId) return;
    try {
      const tracks = await client.command<MediaItem[]>("music/playlists/playlist_tracks", {
        item_id: source.item_id,
        provider_instance_id_or_domain: source.provider || "library",
      });
      const uris = (tracks ?? []).map((t) => t.uri).filter((u): u is string => !!u);
      if (uris.length) {
        await client.command("music/playlists/add_playlist_tracks", {
          db_playlist_id: targetId,
          uris,
        });
      }
    } catch (e) {
      console.warn("[music] mergePlaylist", e);
    }
  }, []);

  const removePlaylistTrack = useCallback(async (playlistId: string, position: number) => {
    await clientRef.current
      ?.command("music/playlists/remove_playlist_tracks", {
        db_playlist_id: playlistId,
        positions_to_remove: [position],
      })
      .catch((e) => console.warn("[music] removePlaylistTrack", e));
  }, []);

  /** P6.2 — MA has no playlist track-reorder command (the builtin provider
   * only appends + removes-by-position), so a reorder is a full rewrite:
   * remove every track, re-add in `orderedUris`. `orderedUris` comes from the
   * widget's already-loaded track list, so the data is never server-only even
   * if the re-add fails; the caller refreshes to show server truth.
   * ponytail: full rewrite per drop — fine for playlists at the render cap;
   * if huge playlists ever need reordering, that's when to want a real MA API. */
  const reorderPlaylist = useCallback(async (playlistId: string, orderedUris: string[]) => {
    const client = clientRef.current;
    const uris = orderedUris.filter((u) => !!u);
    if (!client || uris.length < 2) return;
    try {
      await client.command("music/playlists/remove_playlist_tracks", {
        db_playlist_id: playlistId,
        positions_to_remove: uris.map((_, i) => i + 1),
      });
      await client.command("music/playlists/add_playlist_tracks", {
        db_playlist_id: playlistId,
        uris,
      });
    } catch (e) {
      console.warn("[music] reorderPlaylist", e);
    }
  }, []);

  const setVolume = useCallback((v: number) => {
    volumeSetAtRef.current = Date.now();
    setVolumeState(v);
    sendspinRef.current?.setVolume(v);
  }, []);

  const togglePinPlaylist = useCallback(
    (id: string) =>
      setPinnedPlaylists(
        pinnedPlaylists.includes(id)
          ? pinnedPlaylists.filter((x) => x !== id)
          : [...pinnedPlaylists, id],
      ),
    [pinnedPlaylists, setPinnedPlaylists],
  );

  const openServer = useCallback(() => {
    runCmd("sh", ["-c", `open ${httpBase} || xdg-open ${httpBase}`]).catch((e) =>
      console.warn("[music] openServer", e),
    );
  }, [httpBase]);

  /** P4 — bring the backend up from the offline panel: start the Docker daemon
   * if it's down, then `docker start` the container, then poll for the server
   * and trigger a reconnect. One button; it figures out which step is needed. */
  const startServer = useCallback(async () => {
    if (serverStarting) return;
    setServerStarting(true);
    setError(null);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      let ds = await dockerState();
      if (ds === "no-docker") {
        setError("Docker isn’t installed on this machine — see the widget’s setup notes.");
        return;
      }
      if (ds === "daemon-down") {
        const r = await startDockerDesktop();
        if (!r.ok) {
          setError(r.message);
          return;
        }
        for (let i = 0; i < 24 && ds !== "up"; i++) {
          await wait(2000);
          ds = await dockerState();
        }
        if (ds !== "up") {
          setError("Docker is still starting. Give it a moment, then hit retry.");
          return;
        }
      }
      await startMaContainer(MA_CONTAINER);
      for (let i = 0; i < 15 && !(await maReachable(httpBase)); i++) await wait(1500);
    } finally {
      setServerStarting(false);
      setAttempt((n) => n + 1); // reconnect whatever the outcome
    }
  }, [httpBase, serverStarting]);

  return useMemo(
    () => ({
      state,
      error,
      now,
      currentItem,
      upNext,
      repeatMode,
      shuffle,
      playbackSpeed,
      setPlaybackSpeed,
      queueMode,
      setQueueMode,
      pinnedPlaylists,
      togglePinPlaylist,
      pending,
      results,
      searching,
      volume,
      playlists,
      recentlyPlayed,
      providers,
      serverUrl: httpBase,
      favorites,
      nav,
      canBack: navStack.length > 1,
      navTo,
      navBack,
      navHome,
      retry: () => setAttempt((n) => n + 1),
      search,
      clearResults: () => setResults(null),
      play,
      startRadio,
      playPause,
      next,
      previous,
      seek,
      clearQueue: () => cmd("player_queues/clear"),
      removeFromQueue,
      moveQueueItem,
      moveQueueItemToEnd,
      cycleRepeat,
      toggleShuffle,
      toggleFavorite,
      refreshPlaylists,
      refreshRecent,
      createPlaylist,
      saveQueueAsPlaylist,
      renamePlaylist,
      mergePlaylist,
      deletePlaylist,
      addToPlaylist,
      removePlaylistTrack,
      reorderPlaylist,
      fx,
      setFx,
      applyFx,
      fxAvailable: audioOutput === "media-element",
      playlistImages,
      setPlaylistImage,
      audioOutput,
      setAudioOutput,
      setVolume,
      unlock: () => {
        sendspinRef.current?.unlock().catch(() => {});
        fxRef.current?.resume();
      },
      getProgress: () => {
        const p = sendspinRef.current?.getProgress();
        const live = p
          ? { position: p.positionMs / 1000, duration: p.durationMs / 1000, playbackSpeed: p.playbackSpeed }
          : null;
        const f = seekFreezeRef.current;
        if (f) {
          const t = Date.now();
          const speed = live?.playbackSpeed || 1;
          const projected =
            f.target + ((t - f.at) / 1000) * (nowRef.current?.playing ? speed : 0);
          const converged = live && Math.abs(live.position - projected) < SEEK_CONVERGE_S;
          if (t > f.maxUntil || converged) {
            seekFreezeRef.current = null;
          } else {
            return {
              position: projected,
              duration: live?.duration || nowRef.current?.duration || 0,
              playbackSpeed: speed,
            };
          }
        }
        return live;
      },
      openServer,
      startServer,
      serverStarting,
      manageServer,
      setManageServer,
      imageUrl,
      request,
    }),
    [
      state, error, now, currentItem, upNext, repeatMode, shuffle, playbackSpeed, setPlaybackSpeed,
      queueMode, setQueueMode,
      pinnedPlaylists, togglePinPlaylist, pending,
      results, searching, volume, playlists, recentlyPlayed, providers, httpBase, favorites, nav,
      navStack.length, navTo, navBack, navHome, search, play, startRadio, playPause, next, previous,
      seek, removeFromQueue, moveQueueItem, moveQueueItemToEnd, cycleRepeat, toggleShuffle,
      toggleFavorite, refreshPlaylists, refreshRecent, createPlaylist, saveQueueAsPlaylist,
      renamePlaylist, mergePlaylist, deletePlaylist, addToPlaylist, removePlaylistTrack, reorderPlaylist, setVolume,
      fx, setFx, applyFx, audioOutput, setAudioOutput, playlistImages, setPlaylistImage,
      openServer, startServer, serverStarting, manageServer, setManageServer,
      imageUrl, request, cmd,
    ],
  );
};
