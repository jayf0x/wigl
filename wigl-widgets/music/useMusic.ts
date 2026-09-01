// Data flow (docs/architecture.md → "Data flow pattern"): settings → connect
// effect → two WebSockets (control + Sendspin audio) → useState → render. No
// query library for the queue/now-playing (event-driven); detail views
// (artist/album/playlist) cache their reads with @/wigl/hooks' useQuery.
// One hook, owned by index.tsx.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStorage } from "@/wigl/hooks";
import { runCmd } from "@/wigl/utils";
import { MaClient, type MaEndpoint } from "./maClient";
import {
  DEFAULT_PASSWORD,
  DEFAULT_USERNAME,
  KEYS,
  MA_CONTAINER,
  MA_HOST,
  MA_PORT,
  QUEUE_POLL_MS,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  SEARCH_LIMIT,
  SEARCH_MEDIA_TYPES,
} from "./music.config";
import { connectSendspin, type SendspinHandle } from "./sendspin";
import { maReachable, startMaContainer } from "./serverProcess";
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

export type PlayOption = "play" | "next" | "add";

/** MA QueueOption for each widget-level intent. `"play"` inserts after the
 * current item and skips to it, keeping history + tail intact — the
 * non-destructive "play now". Only the explicit Clear button empties a queue. */
const MA_OPTION: Record<PlayOption, string> = { play: "play", next: "next", add: "add" };

const REPEAT_CYCLE: RepeatMode[] = ["off", "all", "one"];

export interface MusicApi {
  state: ConnState;
  error: string | null;
  now: NowPlaying | null;
  currentItem: QueueItem | null;
  upNext: QueueItem[];
  repeatMode: RepeatMode;
  shuffle: boolean;
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
  search: (query: string) => void;
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
  refreshPlaylists: () => void;
  refreshRecent: () => void;
  createPlaylist: (name: string) => Promise<MediaItem | null>;
  deletePlaylist: (playlist: MediaItem) => void;
  addToPlaylist: (playlistId: string, uris: string[]) => Promise<void>;
  removePlaylistTrack: (playlistId: string, position: number) => Promise<void>;
  /** Open the Music Assistant web UI (to add a provider like YouTube Music). */
  openServer: () => void;
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
  const [manageServer] = useStorage<boolean>(KEYS.manageServer, false);

  const [state, setState] = useState<ConnState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<NowPlaying | null>(null);
  const [currentItem, setCurrentItem] = useState<QueueItem | null>(null);
  const [upNext, setUpNext] = useState<QueueItem[]>([]);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [shuffle, setShuffle] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [volume, setVolumeState] = useState(100);
  const [providers, setProviders] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set());
  const [playlists, setPlaylists] = useState<MediaItem[]>([]);
  const [recentlyPlayed, setRecentlyPlayed] = useState<MediaItem[]>([]);
  const [navStack, setNavStack] = useState<NavView[]>([{ kind: "browse" }]);

  const clientRef = useRef<MaClient | null>(null);
  const sendspinRef = useRef<SendspinHandle | null>(null);
  const queueIdRef = useRef<string | null>(null);
  const nowRef = useRef<NowPlaying | null>(null);
  nowRef.current = now;
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

  // ── snapshot the queue → now-playing + up-next ───────────────────────────
  const refreshQueue = useCallback(async () => {
    const client = clientRef.current;
    const queueId = queueIdRef.current;
    if (!client || !queueId) return;
    try {
      const q = await client.command<PlayerQueue>("player_queues/get", { queue_id: queueId });
      if (!q) return;
      setRepeatMode((q.repeat_mode as RepeatMode) ?? "off");
      setShuffle(!!q.shuffle_enabled);
      const cur = q.current_item ?? null;
      setCurrentItem(cur);
      const media = cur?.media_item ?? null;
      const isRadio = media?.media_type === "radio";
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
              playing: q.state === "playing",
              isRadio,
            }
          : null,
      );
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
  }, [imageUrl]);

  // ── connect: control WS + Sendspin audio WS ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let backoff = RECONNECT_MIN_MS;
    const endpoint: MaEndpoint = { host, port, username, password };

    const scheduleReconnect = () => {
      if (cancelled) return;
      setState("connecting");
      reconnectTimer = setTimeout(() => setAttempt((n) => n + 1), backoff);
      backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
    };

    const teardown = () => {
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
          if (manageServer) await startMaContainer(MA_CONTAINER);
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
          pair: (t) => client.command("sendspin/pair_web_player", { pairing_token: t }),
          onState: (s) => {
            setVolumeState(s.volume);
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

        client.onEvent((ev) => {
          if (ev.object_id && ev.object_id !== audio.playerId) return;
          if (ev.event === "queue_time_updated" && typeof ev.data === "number") {
            setNow((n) => (n ? { ...n, elapsed: ev.data as number } : n));
          } else if (ev.event.startsWith("queue") || ev.event.startsWith("player")) {
            void refreshQueue();
          }
        });

        backoff = RECONNECT_MIN_MS;
        setState("ready");
        void refreshQueue();
        refreshPlaylists();
        refreshRecent();

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
      teardown();
    };
  }, [
    host, port, username, password, manageServer, httpBase, attempt, refreshQueue, refreshPlaylists,
    refreshRecent,
  ]);

  // ── backstop poll for missed events ─────────────────────────────────────
  useEffect(() => {
    if (state !== "ready") return;
    const id = setInterval(() => void refreshQueue(), QUEUE_POLL_MS);
    return () => clearInterval(id);
  }, [state, refreshQueue]);

  // ── actions ────────────────────────────────────────────────────────────
  const cmd = useCallback((command: string, args: Record<string, unknown> = {}) => {
    const client = clientRef.current;
    const queue_id = queueIdRef.current;
    if (!client || !queue_id) return;
    client.command(command, { queue_id, ...args }).catch((e) => console.warn(`[music] ${command}`, e));
  }, []);

  const search = useCallback(
    (query: string) => {
      const client = clientRef.current;
      if (!client || !query.trim()) {
        setResults(null);
        return;
      }
      setSearching(true);
      client
        .command<SearchResults>("music/search", {
          search_query: query.trim(),
          media_types: [...SEARCH_MEDIA_TYPES],
          limit: SEARCH_LIMIT,
          ...(providerFilter ? { providers: [providerFilter] } : {}),
        })
        .then((r) => setResults({ ...EMPTY_RESULTS, ...r }))
        .catch((e) => {
          console.warn("[music] search", e);
          setError("Search failed.");
        })
        .finally(() => setSearching(false));
    },
    [providerFilter],
  );

  const play = useCallback(
    (item: MediaItem, option: PlayOption = "play") => {
      cmd("player_queues/play_media", { media: item.uri, option: MA_OPTION[option] });
      if (option === "play") {
        setResults(null);
        setNavStack([{ kind: "browse" }]);
      }
    },
    [cmd],
  );

  const startRadio = useCallback(
    (item: MediaItem) => {
      cmd("player_queues/play_media", { media: item.uri, option: "play", radio_mode: true });
      setResults(null);
      setNavStack([{ kind: "browse" }]);
    },
    [cmd],
  );

  const seek = useCallback(
    (seconds: number) => {
      const n = nowRef.current;
      if (!n || n.isRadio) return; // nothing to seek in / a live stream (MA 500s on idle)
      const pos = Math.max(0, Math.round(seconds));
      cmd("player_queues/seek", { position: pos });
      setNow((cur) => (cur ? { ...cur, elapsed: pos } : cur));
    },
    [cmd],
  );

  const cycleRepeat = useCallback(() => {
    const nextMode = REPEAT_CYCLE[(REPEAT_CYCLE.indexOf(repeatMode) + 1) % REPEAT_CYCLE.length];
    setRepeatMode(nextMode);
    cmd("player_queues/repeat", { repeat_mode: nextMode });
  }, [cmd, repeatMode]);

  const toggleShuffle = useCallback(() => {
    setShuffle((s) => {
      cmd("player_queues/shuffle", { shuffle_enabled: !s });
      return !s;
    });
  }, [cmd]);

  const removeFromQueue = useCallback(
    (queueItemId: string) => {
      setUpNext((list) => list.filter((i) => i.queue_item_id !== queueItemId));
      cmd("player_queues/delete_item", { item_id_or_index: queueItemId });
    },
    [cmd],
  );

  const moveQueueItem = useCallback(
    (queueItemId: string, posShift: number) => {
      if (!posShift) return;
      setUpNext((list) => {
        const from = list.findIndex((i) => i.queue_item_id === queueItemId);
        if (from < 0) return list;
        const to = Math.max(0, Math.min(list.length - 1, from + posShift));
        if (to === from) return list;
        const copy = [...list];
        const [it] = copy.splice(from, 1);
        copy.splice(to, 0, it);
        return copy;
      });
      cmd("player_queues/move_item", { queue_item_id: queueItemId, pos_shift: posShift });
    },
    [cmd],
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
      cmd("player_queues/move_item_end", { queue_item_id: queueItemId });
    },
    [cmd],
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

  const removePlaylistTrack = useCallback(async (playlistId: string, position: number) => {
    await clientRef.current
      ?.command("music/playlists/remove_playlist_tracks", {
        db_playlist_id: playlistId,
        positions_to_remove: [position],
      })
      .catch((e) => console.warn("[music] removePlaylistTrack", e));
  }, []);

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    sendspinRef.current?.setVolume(v);
  }, []);

  const openServer = useCallback(() => {
    runCmd("sh", ["-c", `open ${httpBase} || xdg-open ${httpBase}`]).catch((e) =>
      console.warn("[music] openServer", e),
    );
  }, [httpBase]);

  return useMemo(
    () => ({
      state,
      error,
      now,
      currentItem,
      upNext,
      repeatMode,
      shuffle,
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
      playPause: () => cmd(now?.playing ? "player_queues/pause" : "player_queues/play"),
      next: () => cmd("player_queues/next"),
      previous: () => cmd("player_queues/previous"),
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
      deletePlaylist,
      addToPlaylist,
      removePlaylistTrack,
      setVolume,
      unlock: () => void sendspinRef.current?.unlock().catch(() => {}),
      openServer,
      imageUrl,
      request,
    }),
    [
      state, error, now, currentItem, upNext, repeatMode, shuffle, results, searching, volume,
      playlists, recentlyPlayed, providers, httpBase, favorites, nav, navStack.length, navTo,
      navBack, navHome, search, play, startRadio, seek, removeFromQueue, moveQueueItem,
      moveQueueItemToEnd, cycleRepeat, toggleShuffle, toggleFavorite, refreshPlaylists, refreshRecent,
      createPlaylist, deletePlaylist, addToPlaylist, removePlaylistTrack, setVolume, openServer,
      imageUrl, request, cmd,
    ],
  );
};
