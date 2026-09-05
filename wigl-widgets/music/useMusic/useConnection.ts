// Data flow (docs/architecture.md → "Data flow pattern"): settings → connect
// effect → two WebSockets (control + Sendspin audio) → useState → render.
//
// This is the widget's known-fragile core (P0–P8 in this project's own
// history): WebSocket reconnect, the optimistic prediction/reconciliation
// that keeps transport controls from snapping back mid-command, and the
// seek-position "freeze" hack that fights a live SDK clock during
// rebuffering. The optimism helpers (`markPending`/`pendingClear`/
// `clearAllPending`) stay merged in here rather than their own hook because
// `markPending`'s timeout calls `refreshQueue`, and `refreshQueue` reads/
// writes the same `optimisticRef` and calls `pendingClear` — splitting them
// apart would need a ref-indirection just to break the cycle, for a section
// this history says to be extra careful with, not less.
import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useStorage } from "@/wigl/hooks";
import { attachAudioFx, type AudioFx, type FxState } from "../audioGraph";
import { MaClient, type MaEndpoint } from "../maClient";
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
  SENDSPIN_OUTPUT,
} from "../music.config";
import { connectSendspin, type SendspinHandle } from "../sendspin";
import { maReachable, startMaContainer } from "../serverProcess";
import type {
  ConnState,
  MediaImage,
  NowPlaying,
  PlayerQueue,
  QueueItem,
  RepeatMode,
} from "../types";
import type { OptimisticState } from "./types";

// P0.3 — post-seek playhead projection. Hold the projected position until the
// SDK clock lands within this many seconds of it, or this long has passed.
const SEEK_CONVERGE_S = 1.5;

export const useConnection = ({
  clientRef,
  queueIdRef,
  nowRef,
  upNextRef,
  playbackSpeedRef,
  speedSetAtRef,
  providersRef,
  optimisticRef,
  seekFreezeRef,
  fxRef,
  fxValRef,
  refreshPlaylists,
  refreshRecent,
}: {
  clientRef: MutableRefObject<MaClient | null>;
  queueIdRef: MutableRefObject<string | null>;
  nowRef: MutableRefObject<NowPlaying | null>;
  upNextRef: MutableRefObject<QueueItem[]>;
  playbackSpeedRef: MutableRefObject<number>;
  speedSetAtRef: MutableRefObject<number>;
  providersRef: MutableRefObject<string[]>;
  optimisticRef: MutableRefObject<OptimisticState>;
  seekFreezeRef: MutableRefObject<{ target: number; at: number; maxUntil: number } | null>;
  fxRef: MutableRefObject<AudioFx | null>;
  fxValRef: MutableRefObject<FxState>;
  refreshPlaylists: () => void;
  refreshRecent: () => void;
}) => {
  const [host] = useStorage<string>(KEYS.host, MA_HOST);
  const [port] = useStorage<number>(KEYS.port, MA_PORT);
  const [username] = useStorage<string>(KEYS.username, DEFAULT_USERNAME);
  const [password] = useStorage<string>(KEYS.password, DEFAULT_PASSWORD);
  const [manageServer, setManageServer] = useStorage<boolean>(KEYS.manageServer, false);
  // Read inside boot() only — toggling it must NOT tear down a live connection
  // (P0.6: doing so stopped playback). It just changes whether a *future*
  // reconnect tries to auto-start the container.
  const manageServerRef = useRef(manageServer);
  manageServerRef.current = manageServer;
  const [audioOutput, setAudioOutputStored] = useStorage<"direct" | "media-element">(
    KEYS.audioOutput,
    SENDSPIN_OUTPUT,
  );
  const setAudioOutput = useCallback(
    (mode: "direct" | "media-element") => setAudioOutputStored(mode),
    [setAudioOutputStored],
  );
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

  const [state, setState] = useState<ConnState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<NowPlaying | null>(null);
  const [currentItem, setCurrentItem] = useState<QueueItem | null>(null);
  const [upNext, setUpNext] = useState<QueueItem[]>([]);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [shuffle, setShuffle] = useState(false);
  const [playbackSpeed, setPlaybackSpeedState] = useState(1);
  const [volume, setVolumeState] = useState(100);
  const [providers, setProviders] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<Set<string>>(() => new Set());

  const sendspinRef = useRef<SendspinHandle | null>(null);
  nowRef.current = now;
  const repeatRef = useRef<RepeatMode>(repeatMode);
  repeatRef.current = repeatMode;
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  playbackSpeedRef.current = playbackSpeed;
  // Ignore the server's playback_speed echo right after a local change (same
  // pattern as volume) so the badge/slider never snap mid-interaction.
  upNextRef.current = upNext;
  providersRef.current = providers;
  // action → timeout handle for the not-yet-confirmed transport commands.
  const pendingRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Ignore SDK volume echoes right after a local drag so the slider never snaps.
  const volumeSetAtRef = useRef(0);
  const httpBase = `http://${host}:${port}`;

  const imageUrl = useCallback(
    (img?: MediaImage | null): string | null => {
      if (!img) return null;
      if (img.proxy_id) return `${httpBase}/imageproxy/${img.proxy_id}`;
      return img.remotely_accessible ? img.path : null;
    },
    [httpBase],
  );

  const request = useCallback(
    <T = unknown>(command: string, args: Record<string, unknown> = {}) => {
      const client = clientRef.current;
      if (!client) return Promise.reject(new Error("not connected")) as Promise<T>;
      return client.command<T>(command, args);
    },
    [clientRef],
  );

  const cmd = useCallback(
    (command: string, args: Record<string, unknown> = {}) => {
      const client = clientRef.current;
      const queue_id = queueIdRef.current;
      if (!client || !queue_id) return;
      client.command(command, { queue_id, ...args }).catch((e) => console.warn(`[music] ${command}`, e));
    },
    [clientRef, queueIdRef],
  );

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
  }, [clientRef, queueIdRef, optimisticRef, speedSetAtRef, imageUrl, pendingClear]);

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
    [optimisticRef, refreshQueue, syncPending],
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
    refreshRecent, audioOutput, cmd, clientRef, queueIdRef, fxRef, fxValRef, nowRef,
    playbackSpeedRef, speedSetAtRef,
  ]);

  // ── backstop poll for missed events ─────────────────────────────────────
  useEffect(() => {
    if (state !== "ready") return;
    const id = setInterval(() => void refreshQueue(), QUEUE_POLL_MS);
    return () => clearInterval(id);
  }, [state, refreshQueue]);

  const setVolume = useCallback((v: number) => {
    volumeSetAtRef.current = Date.now();
    setVolumeState(v);
    sendspinRef.current?.setVolume(v);
  }, []);

  return {
    state,
    error,
    now,
    setNow,
    currentItem,
    setCurrentItem,
    upNext,
    setUpNext,
    repeatMode,
    setRepeatMode,
    shuffle,
    setShuffle,
    playbackSpeed,
    setPlaybackSpeedState,
    volume,
    providers,
    pending,
    manageServer,
    setManageServer,
    audioOutput,
    setAudioOutput,
    httpBase,
    imageUrl,
    request,
    cmd,
    markPending,
    setError,
    setAttempt,
    retry: () => setAttempt((n) => n + 1),
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
    setVolume,
  };
};
