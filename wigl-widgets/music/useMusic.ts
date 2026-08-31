// Data flow (docs/architecture.md → "Data flow pattern"): settings → connect
// effect → two WebSockets (control + Sendspin audio) → useState → render. No
// query library. One hook, owned by index.tsx.

import { useCallback, useEffect, useRef, useState } from "react";
import { useStorage } from "@/wigl/hooks";
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
import type { ConnState, MediaImage, MediaItem, NowPlaying, PlayerQueue, QueueItem, SearchResults } from "./types";

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

export interface MusicApi {
  state: ConnState;
  error: string | null;
  now: NowPlaying | null;
  upNext: QueueItem[];
  results: SearchResults | null;
  searching: boolean;
  volume: number;
  retry: () => void;
  search: (query: string) => void;
  clearResults: () => void;
  play: (item: MediaItem, option?: PlayOption) => void;
  startRadio: (item: MediaItem) => void;
  playPause: () => void;
  next: () => void;
  previous: () => void;
  clearQueue: () => void;
  setVolume: (v: number) => void;
  /** Prime the browser audio output — call from a user gesture (first play). */
  unlock: () => void;
  imageUrl: (img?: MediaImage | null) => string | null;
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
  const [upNext, setUpNext] = useState<QueueItem[]>([]);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [volume, setVolumeState] = useState(100);
  const [attempt, setAttempt] = useState(0);

  const clientRef = useRef<MaClient | null>(null);
  const sendspinRef = useRef<SendspinHandle | null>(null);
  const queueIdRef = useRef<string | null>(null);
  const httpBase = `http://${host}:${port}`;

  const imageUrl = useCallback(
    (img?: MediaImage | null): string | null => {
      if (!img) return null;
      if (img.proxy_id) return `${httpBase}/imageproxy/${img.proxy_id}`;
      return img.remotely_accessible ? img.path : null;
    },
    [httpBase],
  );

  // ── snapshot the queue → now-playing + up-next ───────────────────────────
  const refreshQueue = useCallback(async () => {
    const client = clientRef.current;
    const queueId = queueIdRef.current;
    if (!client || !queueId) return;
    try {
      const q = await client.command<PlayerQueue>("player_queues/get", { queue_id: queueId });
      if (!q) return;
      const cur = q.current_item ?? null;
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
          limit: 20,
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
  }, [host, port, username, password, manageServer, httpBase, attempt, refreshQueue]);

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
      const maOption = option === "play" ? "replace" : option === "next" ? "next" : "add";
      cmd("player_queues/play_media", { media: item.uri, option: maOption });
      if (option === "play") setResults(null);
    },
    [cmd],
  );

  const startRadio = useCallback(
    (item: MediaItem) => {
      cmd("player_queues/play_media", { media: item.uri, option: "replace", radio_mode: true });
      setResults(null);
    },
    [cmd],
  );

  const setVolume = useCallback((v: number) => {
    setVolumeState(v);
    sendspinRef.current?.setVolume(v);
  }, []);

  return {
    state,
    error,
    now,
    upNext,
    results,
    searching,
    volume,
    retry: () => setAttempt((n) => n + 1),
    search,
    clearResults: () => setResults(null),
    play,
    startRadio,
    playPause: () => cmd(now?.playing ? "player_queues/pause" : "player_queues/play"),
    next: () => cmd("player_queues/next"),
    previous: () => cmd("player_queues/previous"),
    clearQueue: () => cmd("player_queues/clear"),
    setVolume,
    unlock: () => void sendspinRef.current?.unlock().catch(() => {}),
    imageUrl,
  };
};
