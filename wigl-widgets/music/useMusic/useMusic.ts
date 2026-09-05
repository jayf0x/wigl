// The widget's one hook, owned by index.tsx. This is the composing shell —
// refs/state shared across more than one concern, plus the final assembled
// API. Each concern lives in its own sibling hook: useConnection (boot/
// reconnect, the optimistic-prediction machinery, refreshQueue — see its own
// doc comment for why those three stay merged), useTransportActions (play/
// pause/skip/seek/repeat/shuffle/speed/search), useQueueActions (up-next
// remove/reorder), useFavorites, usePlaylistActions (library playlist CRUD),
// useFx (the Web Audio EQ/reverb chain), useServerControl (the offline
// panel's Docker recovery).
import { useCallback, useMemo, useRef, useState } from "react";
import { useStorage } from "@/wigl/hooks";
import { KEYS } from "../music.config";
import type { FxState } from "../audioGraph";
import type { MaClient } from "../maClient";
import type {
  ConnState,
  MediaImage,
  MediaItem,
  NavView,
  NowPlaying,
  QueueItem,
  RepeatMode,
  SearchResults,
} from "../types";
import type { OptimisticState, PlayOption, QueueMode } from "./types";
import { useConnection } from "./useConnection";
import { useFavorites } from "./useFavorites";
import { useFx } from "./useFx";
import { usePlaylistActions } from "./usePlaylistActions";
import { useQueueActions } from "./useQueueActions";
import { useServerControl } from "./useServerControl";
import { useTransportActions } from "./useTransportActions";

export type { PlayOption, QueueMode };

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
  // Refs several sibling hooks share — created here (not inside whichever
  // hook happens to populate them first) so every hook that needs one reads
  // and writes the exact same object, regardless of call order.
  const clientRef = useRef<MaClient | null>(null);
  const queueIdRef = useRef<string | null>(null);
  const nowRef = useRef<NowPlaying | null>(null);
  const upNextRef = useRef<QueueItem[]>([]);
  const playbackSpeedRef = useRef(1);
  const speedSetAtRef = useRef(0);
  const providersRef = useRef<string[]>([]);
  const optimisticRef = useRef<OptimisticState>({});
  const seekFreezeRef = useRef<{ target: number; at: number; maxUntil: number } | null>(null);

  const [navStack, setNavStack] = useState<NavView[]>([{ kind: "browse" }]);
  const nav = navStack[navStack.length - 1] ?? { kind: "browse" };
  const navTo = useCallback((v: NavView) => {
    setNavStack((s) => (v.kind === "browse" ? [{ kind: "browse" }] : [...s, v]));
  }, []);
  const navBack = useCallback(() => setNavStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const navHome = useCallback(() => setNavStack([{ kind: "browse" }]), []);

  const [pinnedPlaylists, setPinnedPlaylists] = useStorage<string[]>(KEYS.pinnedPlaylists, []);
  const togglePinPlaylist = useCallback(
    (id: string) =>
      setPinnedPlaylists(
        pinnedPlaylists.includes(id)
          ? pinnedPlaylists.filter((x) => x !== id)
          : [...pinnedPlaylists, id],
      ),
    [pinnedPlaylists, setPinnedPlaylists],
  );

  // E3 — per-playlist custom cover/background images.
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

  const playlistActions = usePlaylistActions({ clientRef, queueIdRef });
  const fx = useFx();
  const connection = useConnection({
    clientRef,
    queueIdRef,
    nowRef,
    upNextRef,
    playbackSpeedRef,
    speedSetAtRef,
    providersRef,
    optimisticRef,
    seekFreezeRef,
    fxRef: fx.fxRef,
    fxValRef: fx.fxValRef,
    refreshPlaylists: playlistActions.refreshPlaylists,
    refreshRecent: playlistActions.refreshRecent,
  });
  const transport = useTransportActions({
    clientRef,
    queueIdRef,
    cmd: connection.cmd,
    markPending: connection.markPending,
    imageUrl: connection.imageUrl,
    nowRef,
    upNextRef,
    optimisticRef,
    seekFreezeRef,
    playbackSpeedRef,
    speedSetAtRef,
    providersRef,
    setNow: connection.setNow,
    setCurrentItem: connection.setCurrentItem,
    setUpNext: connection.setUpNext,
    setRepeatMode: connection.setRepeatMode,
    setShuffle: connection.setShuffle,
    setPlaybackSpeedState: connection.setPlaybackSpeedState,
    setNavStack,
    repeatMode: connection.repeatMode,
    shuffle: connection.shuffle,
  });
  const queueActions = useQueueActions({
    cmd: connection.cmd,
    markPending: connection.markPending,
    optimisticRef,
    setUpNext: connection.setUpNext,
  });
  const favorites = useFavorites({ clientRef });
  const serverControl = useServerControl({
    httpBase: connection.httpBase,
    setError: connection.setError,
    setAttempt: connection.setAttempt,
  });

  return useMemo(
    () => ({
      state: connection.state,
      error: connection.error,
      now: connection.now,
      currentItem: connection.currentItem,
      upNext: connection.upNext,
      repeatMode: connection.repeatMode,
      shuffle: connection.shuffle,
      playbackSpeed: connection.playbackSpeed,
      setPlaybackSpeed: transport.setPlaybackSpeed,
      queueMode: transport.queueMode,
      setQueueMode: transport.setQueueMode,
      pinnedPlaylists,
      togglePinPlaylist,
      pending: connection.pending,
      results: transport.results,
      searching: transport.searching,
      volume: connection.volume,
      playlists: playlistActions.playlists,
      recentlyPlayed: playlistActions.recentlyPlayed,
      providers: connection.providers,
      serverUrl: connection.httpBase,
      favorites: favorites.favorites,
      nav,
      canBack: navStack.length > 1,
      navTo,
      navBack,
      navHome,
      retry: connection.retry,
      search: transport.search,
      clearResults: transport.clearResults,
      play: transport.play,
      startRadio: transport.startRadio,
      playPause: transport.playPause,
      next: transport.next,
      previous: transport.previous,
      seek: transport.seek,
      clearQueue: transport.clearQueue,
      removeFromQueue: queueActions.removeFromQueue,
      moveQueueItem: queueActions.moveQueueItem,
      moveQueueItemToEnd: queueActions.moveQueueItemToEnd,
      cycleRepeat: transport.cycleRepeat,
      toggleShuffle: transport.toggleShuffle,
      toggleFavorite: favorites.toggleFavorite,
      refreshPlaylists: playlistActions.refreshPlaylists,
      refreshRecent: playlistActions.refreshRecent,
      createPlaylist: playlistActions.createPlaylist,
      saveQueueAsPlaylist: playlistActions.saveQueueAsPlaylist,
      renamePlaylist: playlistActions.renamePlaylist,
      mergePlaylist: playlistActions.mergePlaylist,
      deletePlaylist: playlistActions.deletePlaylist,
      addToPlaylist: playlistActions.addToPlaylist,
      removePlaylistTrack: playlistActions.removePlaylistTrack,
      reorderPlaylist: playlistActions.reorderPlaylist,
      fx: fx.fx,
      setFx: fx.setFx,
      applyFx: fx.applyFx,
      fxAvailable: connection.audioOutput === "media-element",
      playlistImages,
      setPlaylistImage,
      audioOutput: connection.audioOutput,
      setAudioOutput: connection.setAudioOutput,
      setVolume: connection.setVolume,
      unlock: connection.unlock,
      getProgress: connection.getProgress,
      openServer: serverControl.openServer,
      startServer: serverControl.startServer,
      serverStarting: serverControl.serverStarting,
      manageServer: connection.manageServer,
      setManageServer: connection.setManageServer,
      imageUrl: connection.imageUrl,
      request: connection.request,
    }),
    [
      connection.state, connection.error, connection.now, connection.currentItem, connection.upNext,
      connection.repeatMode, connection.shuffle, connection.playbackSpeed, transport.setPlaybackSpeed,
      transport.queueMode, transport.setQueueMode,
      pinnedPlaylists, togglePinPlaylist, connection.pending,
      transport.results, transport.searching, connection.volume, playlistActions.playlists,
      playlistActions.recentlyPlayed, connection.providers, connection.httpBase, favorites.favorites, nav,
      navStack.length, navTo, navBack, navHome, transport.search, transport.play, transport.startRadio,
      transport.playPause, transport.next, transport.previous,
      transport.seek, queueActions.removeFromQueue, queueActions.moveQueueItem, queueActions.moveQueueItemToEnd,
      transport.cycleRepeat, transport.toggleShuffle,
      favorites.toggleFavorite, playlistActions.refreshPlaylists, playlistActions.refreshRecent,
      playlistActions.createPlaylist, playlistActions.saveQueueAsPlaylist,
      playlistActions.renamePlaylist, playlistActions.mergePlaylist, playlistActions.deletePlaylist,
      playlistActions.addToPlaylist, playlistActions.removePlaylistTrack, playlistActions.reorderPlaylist,
      connection.setVolume,
      fx.fx, fx.setFx, fx.applyFx, connection.audioOutput, connection.setAudioOutput, playlistImages, setPlaylistImage,
      serverControl.openServer, serverControl.startServer, serverControl.serverStarting, connection.manageServer,
      connection.setManageServer,
      connection.imageUrl, connection.request, connection.cmd,
    ],
  );
};
