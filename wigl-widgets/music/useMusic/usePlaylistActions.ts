// Library playlist CRUD + the recently-played/library-playlists snapshots.
// Self-contained: only reads `clientRef`/`queueIdRef` (populated by
// useConnection) and owns its own `playlists`/`recentlyPlayed` state — no
// dependency on the optimistic-prediction machinery.
import { useCallback, useState } from "react";
import type { MutableRefObject } from "react";
import type { MaClient } from "../maClient";
import type { MediaItem, QueueItem } from "../types";

export const usePlaylistActions = ({
  clientRef,
  queueIdRef,
}: {
  clientRef: MutableRefObject<MaClient | null>;
  queueIdRef: MutableRefObject<string | null>;
}) => {
  const [playlists, setPlaylists] = useState<MediaItem[]>([]);
  const [recentlyPlayed, setRecentlyPlayed] = useState<MediaItem[]>([]);

  const refreshPlaylists = useCallback(() => {
    clientRef.current
      ?.command<MediaItem[]>("music/playlists/library_items")
      .then((p) => setPlaylists(Array.isArray(p) ? p : []))
      .catch((e) => console.warn("[music] playlists", e));
  }, [clientRef]);

  const refreshRecent = useCallback(() => {
    clientRef.current
      ?.command<MediaItem[]>("music/recently_played_items", { limit: 50 })
      .then((r) => setRecentlyPlayed(Array.isArray(r) ? r : []))
      .catch((e) => console.warn("[music] recent", e));
  }, [clientRef]);

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
    [clientRef, refreshPlaylists],
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
    [clientRef, refreshPlaylists],
  );

  const addToPlaylist = useCallback(
    async (playlistId: string, uris: string[]) => {
      const client = clientRef.current;
      if (!client || uris.length === 0) return;
      await client
        .command("music/playlists/add_playlist_tracks", { db_playlist_id: playlistId, uris })
        .catch((e) => console.warn("[music] addToPlaylist", e));
    },
    [clientRef],
  );

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
    [clientRef, queueIdRef, refreshPlaylists],
  );

  /** E1 — rename an editable library playlist (sticks; needs `overwrite:true`
   * and the full playlist object as `update`). No-op for smart playlists. */
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
    [clientRef, refreshPlaylists],
  );

  /** E4 — append every track of `source` into playlist `targetId`. */
  const mergePlaylist = useCallback(
    async (source: MediaItem, targetId: string) => {
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
    },
    [clientRef],
  );

  const removePlaylistTrack = useCallback(
    async (playlistId: string, position: number) => {
      await clientRef.current
        ?.command("music/playlists/remove_playlist_tracks", {
          db_playlist_id: playlistId,
          positions_to_remove: [position],
        })
        .catch((e) => console.warn("[music] removePlaylistTrack", e));
    },
    [clientRef],
  );

  /** P6.2 — MA has no playlist track-reorder command (the builtin provider
   * only appends + removes-by-position), so a reorder is a full rewrite:
   * remove every track, re-add in `orderedUris`. `orderedUris` comes from the
   * widget's already-loaded track list, so the data is never server-only even
   * if the re-add fails; the caller refreshes to show server truth.
   * ponytail: full rewrite per drop — fine for playlists at the render cap;
   * if huge playlists ever need reordering, that's when to want a real MA API. */
  const reorderPlaylist = useCallback(
    async (playlistId: string, orderedUris: string[]) => {
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
    },
    [clientRef],
  );

  return {
    playlists,
    recentlyPlayed,
    refreshPlaylists,
    refreshRecent,
    createPlaylist,
    deletePlaylist,
    addToPlaylist,
    saveQueueAsPlaylist,
    renamePlaylist,
    mergePlaylist,
    removePlaylistTrack,
    reorderPlaylist,
  };
};
