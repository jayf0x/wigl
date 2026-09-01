// Live e2e against the local Music Assistant Docker container (`wigl-ma`,
// see SETUP.md). Skips — does not fail — when MA isn't reachable, same
// convention as wigl-widgets/LocalCode/tests/*.e2e.test.ts.
//
// What this covers: the widget's whole data + transport layer against the
// real server — control-WS auth, the command/response envelope, `music/search`
// result shapes (the drift regression: these shapes come from the live API,
// not a guess), the `/sendspin` audio-proxy auth handshake, and the image
// proxy. What it does NOT cover: PCM decode + actual sound from the speakers
// — that needs a browser AudioContext and a human ear (see
// tests/manual/audio-check.md).

import { describe, expect, test } from "bun:test";
import { DEFAULT_PASSWORD, DEFAULT_USERNAME, MA_HOST, MA_PORT } from "../music.config";
import { login, MaClient } from "../maClient";
import type { MediaItem, PlayerQueue, SearchResults } from "../types";

const endpoint = {
  host: MA_HOST,
  port: MA_PORT,
  username: DEFAULT_USERNAME,
  password: DEFAULT_PASSWORD,
};
const base = `http://${endpoint.host}:${endpoint.port}`;

const reachable = await fetch(`${base}/info`, { signal: AbortSignal.timeout(2000) })
  .then((r) => r.ok)
  .catch(() => false);

if (!reachable) {
  console.warn(`[music e2e] Music Assistant not reachable at ${base} — skipping. Start it: docker start wigl-ma`);
}

describe("music widget ↔ Music Assistant (live)", () => {
  test.skipIf(!reachable)("logs in and the control WS authenticates", async () => {
    const token = await login(endpoint);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(20);

    const client = new MaClient(endpoint, () => {});
    await client.connect();
    expect(typeof client.authToken).toBe("string");
    expect(client.authToken.length).toBeGreaterThan(20);
    client.close();
  });

  test.skipIf(!reachable)("music/search returns the shapes types.ts expects", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    try {
      const results = await client.command<SearchResults>("music/search", {
        search_query: "jazz",
        media_types: ["radio"],
        limit: 3,
      });
      expect(Array.isArray(results.radio)).toBe(true);
      expect(results.radio.length).toBeGreaterThan(0);

      const station = results.radio[0];
      expect(typeof station.uri).toBe("string");
      expect(station.uri).toMatch(/^\w+:\/\//); // provider://…
      expect(station.media_type).toBe("radio");
      expect(typeof station.name).toBe("string");
      // image proxy id is what imageUrl() builds a URL from
      const img = station.metadata?.images?.[0];
      if (img) expect(typeof img.proxy_id === "string" || img.remotely_accessible).toBeTruthy();
    } finally {
      client.close();
    }
  });

  test.skipIf(!reachable)("the /sendspin audio proxy accepts the widget's auth handshake", async () => {
    const token = await login(endpoint);
    const ws = new WebSocket(`ws://${endpoint.host}:${endpoint.port}/sendspin`);
    ws.binaryType = "arraybuffer";
    const ack = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no auth_ok within 5s")), 5000);
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token, client_id: "music-e2e-probe" }));
      ws.onmessage = (e) => {
        clearTimeout(timer);
        resolve(typeof e.data === "string" ? (JSON.parse(e.data).type as string) : "binary");
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("socket error"));
      };
    });
    ws.close();
    expect(ack).toBe("auth_ok");
  });

  test.skipIf(!reachable)("image proxy serves an image for a search result", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    try {
      const results = await client.command<SearchResults>("music/search", {
        search_query: "lofi",
        media_types: ["radio"],
        limit: 5,
      });
      const withArt = results.radio.find((r) => r.metadata?.images?.[0]?.proxy_id);
      if (!withArt) return; // no arted station in this result set — nothing to assert
      const proxyId = withArt.metadata!.images![0].proxy_id!;
      const res = await fetch(`${base}/imageproxy/${proxyId}`);
      expect(res.ok).toBe(true);
      expect(res.headers.get("content-type") ?? "").toMatch(/^image\//);
    } finally {
      client.close();
    }
  });

  // The `ytmusic_free` provider (see SETUP.md) is anonymous but optional — if
  // it isn't configured this test no-ops rather than fails.
  test.skipIf(!reachable)("YouTube Music (Free), when configured, returns real tracks", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    try {
      const providers = await client.command<{ instance_id: string; type: string; enabled: boolean }[]>(
        "config/providers",
      );
      const hasYt = (providers ?? []).some(
        (p) => p.type === "music" && p.enabled && p.instance_id.startsWith("ytmusic"),
      );
      if (!hasYt) return;

      const results = await client.command<SearchResults>("music/search", {
        search_query: "daft punk get lucky",
        media_types: ["track"],
        limit: 5,
        providers: ["ytmusic_free"],
      });
      expect(results.tracks.length).toBeGreaterThan(0);
      const track = results.tracks[0];
      expect(track.uri).toMatch(/^ytmusic_free/);
      expect((track.artists ?? []).length).toBeGreaterThan(0);
    } finally {
      client.close();
    }
  });

  // ── drift regressions for the commands the player-buildout leans on ──────
  // Each asserts the real arg/return shape against the running server so a
  // Music Assistant upgrade that renames a field breaks CI, not the widget.

  test.skipIf(!reachable)("artist + album detail commands return navigable shapes", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    try {
      const res = await client.command<SearchResults>("music/search", {
        search_query: "daft punk",
        media_types: ["artist", "album"],
        limit: 3,
      });
      const artist = res.artists[0];
      expect(artist?.item_id).toBeTruthy();
      expect(artist?.provider).toBeTruthy();

      // top_tracks / artist_albums take {item_id, provider_instance_id_or_domain}
      const idArgs = { item_id: artist.item_id, provider_instance_id_or_domain: artist.provider };
      const top = await client.command<MediaItem[]>("music/artists/top_tracks", idArgs);
      expect(Array.isArray(top)).toBe(true);
      const albums = await client.command<MediaItem[]>("music/artists/artist_albums", idArgs);
      expect(Array.isArray(albums)).toBe(true);

      const album = res.albums[0] ?? albums[0];
      if (album?.item_id) {
        const tracks = await client.command<MediaItem[]>("music/albums/album_tracks", {
          item_id: album.item_id,
          provider_instance_id_or_domain: album.provider,
        });
        expect(Array.isArray(tracks)).toBe(true);
        if (tracks.length) {
          expect(typeof tracks[0].uri).toBe("string");
          expect((tracks[0].artists ?? []).length).toBeGreaterThan(0);
        }
      }
    } finally {
      client.close();
    }
  });

  test.skipIf(!reachable)("favourite add → read-back → remove round-trips", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    try {
      const res = await client.command<SearchResults>("music/search", {
        search_query: "daft punk one more time",
        media_types: ["track"],
        limit: 1,
      });
      const uri = res.tracks[0]?.uri;
      if (!uri) return;

      await client.command("music/favorites/add_item", { item: uri });
      const lib = await client.command<{ favorite?: boolean; media_type?: string; item_id?: string }>(
        "music/item_by_uri",
        { uri },
      );
      expect(lib.favorite).toBe(true);
      expect(lib.media_type).toBeTruthy();
      await client.command("music/favorites/remove_item", {
        media_type: lib.media_type,
        library_item_id: lib.item_id,
      });
      const after = await client.command<{ favorite?: boolean }>("music/item_by_uri", { uri });
      expect(after.favorite).toBe(false);
    } finally {
      client.close();
    }
  });

  test.skipIf(!reachable)("recently_played_items returns replayable items (H1 view)", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    try {
      const items = await client.command<MediaItem[]>("music/recently_played_items", { limit: 50 });
      expect(Array.isArray(items)).toBe(true);
      for (const it of items) {
        expect(typeof it.uri).toBe("string");
        expect(it.uri).toMatch(/^\w[\w-]*:\/\//); // provider://… — playable by uri
        expect(typeof it.media_type).toBe("string");
        // ItemMapping carries a single `image` (may be null), not metadata.images
        expect("image" in it).toBe(true);
      }
    } finally {
      client.close();
    }
  });

  test.skipIf(!reachable)("playlists library_items shape (Home Playlists tab)", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    try {
      const pls = await client.command<
        { name: string; uri: string; item_id: string; is_editable?: boolean }[]
      >("music/playlists/library_items");
      expect(Array.isArray(pls)).toBe(true);
      for (const p of pls) {
        expect(typeof p.name).toBe("string");
        expect(p.uri).toMatch(/^library:\/\/playlist\//);
        expect(typeof p.item_id).toBe("string");
      }
    } finally {
      client.close();
    }
  });

  // repeat / shuffle / seek mutate a queue — run them as no-ops against
  // whatever queue exists (set each to its current value) so the assertion is
  // "the command + arg shape is accepted", not a playback change.
  test.skipIf(!reachable)("repeat / shuffle / seek accept their documented args", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    try {
      const queues = await client.command<PlayerQueue[]>("player_queues/all");
      const q = (queues ?? [])[0];
      if (!q) return; // no player registered — nothing to poke safely

      expect(["off", "one", "all", "unknown"]).toContain(q.repeat_mode);
      expect(typeof q.shuffle_enabled).toBe("boolean");
      expect(typeof q.flow_mode === "boolean" || q.flow_mode === undefined).toBe(true);

      await client.command("player_queues/repeat", {
        queue_id: q.queue_id,
        repeat_mode: q.repeat_mode === "unknown" ? "off" : q.repeat_mode,
      });
      await client.command("player_queues/shuffle", {
        queue_id: q.queue_id,
        shuffle_enabled: q.shuffle_enabled,
      });
      // seek only makes sense with something playing — MA 500s on an idle queue
      if (q.state === "playing" && q.current_item) {
        await client.command("player_queues/seek", {
          queue_id: q.queue_id,
          position: Math.max(0, Math.round(q.elapsed_time ?? 0)),
        });
      }
    } finally {
      client.close();
    }
  });

  // D1 browse: root lists provider folders; a provider path lists sub-folders,
  // each carrying `path` for the next hop. (recommendations is empty on a fresh
  // library — browse is the real discover surface.)
  test.skipIf(!reachable)("music/browse root + a provider path return folders with `path`", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    try {
      const root = await client.command<{ media_type: string; name: string; path?: string }[]>(
        "music/browse",
        {},
      );
      expect(Array.isArray(root)).toBe(true);
      const rb = root.find((f) => (f.path ?? "").startsWith("radiobrowser://"));
      expect(rb).toBeTruthy();
      expect(rb?.media_type).toBe("folder");

      const sub = await client.command<{ media_type: string; name: string; path?: string }[]>(
        "music/browse",
        { path: rb!.path },
      );
      expect(Array.isArray(sub)).toBe(true);
      // at least one real drill-down folder (besides the ".." entry)
      expect(sub.some((f) => f.name !== ".." && f.media_type === "folder" && !!f.path)).toBe(true);
    } finally {
      client.close();
    }
  });

  test.skipIf(!reachable)("music/search honours a media_types filter (D1 pills)", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    try {
      const r = await client.command<SearchResults>("music/search", {
        search_query: "daft punk",
        media_types: ["artist"],
        limit: 3,
      });
      expect(Array.isArray(r.artists)).toBe(true);
      // asking for only artists → tracks/albums come back empty
      expect(r.tracks.length).toBe(0);
      expect(r.albums.length).toBe(0);
    } finally {
      client.close();
    }
  });

  // B1 parallel search: the widget fans out one music/search per enabled
  // provider, passing its **instance id** (not just a domain) in `providers`.
  // Assert MA accepts an instance id and scopes the result to that provider.
  test.skipIf(!reachable)("music/search accepts a provider instance id and scopes to it", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    try {
      const provs = await client.command<{ instance_id: string; domain: string; type: string; enabled: boolean }[]>(
        "config/providers",
      );
      const rb = (provs ?? []).find((p) => p.type === "music" && p.enabled && p.domain === "radiobrowser");
      if (!rb) return; // radiobrowser not configured on this box

      const r = await client.command<SearchResults>("music/search", {
        search_query: "jazz",
        media_types: ["radio", "track"],
        limit: 5,
        providers: [rb.instance_id],
      });
      expect(Array.isArray(r.radio)).toBe(true);
      // radiobrowser only surfaces radio — every result uri must be its own
      for (const it of [...r.radio, ...r.tracks]) expect(it.uri.startsWith("radiobrowser://")).toBe(true);
    } finally {
      client.close();
    }
  });

  // P4/P5 playlists: create → add → read positions → remove → delete round-trip.
  test.skipIf(!reachable)("playlist create / add / read / remove / delete round-trips", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    let plId: string | undefined;
    try {
      const created = await client.command<{ item_id: string; is_editable?: boolean; provider: string }>(
        "music/playlists/create_playlist",
        { name: `wigl e2e ${Date.now()}` },
      );
      plId = created.item_id;
      expect(created.provider).toBe("library");
      expect(created.is_editable).toBe(true);

      const res = await client.command<SearchResults>("music/search", {
        search_query: "daft punk",
        media_types: ["track"],
        limit: 2,
      });
      const uris = res.tracks.slice(0, 2).map((t) => t.uri);
      if (uris.length < 2) return;

      await client.command("music/playlists/add_playlist_tracks", { db_playlist_id: plId, uris });
      await new Promise((r) => setTimeout(r, 1500)); // add is an async BackgroundTask

      const tracks = await client.command<{ position?: number; uri: string }[]>("music/playlists/playlist_tracks", {
        item_id: plId,
        provider_instance_id_or_domain: "library",
      });
      expect(tracks.length).toBe(2);
      // positions are 1-based
      expect(tracks.map((t) => t.position).sort()).toEqual([1, 2]);

      await client.command("music/playlists/remove_playlist_tracks", {
        db_playlist_id: plId,
        positions_to_remove: [1],
      });
      await new Promise((r) => setTimeout(r, 1500));
      const after = await client.command<unknown[]>("music/playlists/playlist_tracks", {
        item_id: plId,
        provider_instance_id_or_domain: "library",
      });
      expect(after.length).toBe(1);
    } finally {
      if (plId)
        await client
          .command("music/library/remove_item", { media_type: "playlist", library_item_id: plId })
          .catch(() => {});
      client.close();
    }
  });

  // D1/D3: play_media accepts option:"replace" (the D1 toggle's Replace mode)
  // and a playlist uri as `media` (loading a playlist into the queue).
  test.skipIf(!reachable)("play_media accepts option:replace and a playlist uri", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    let queueId: string | undefined;
    try {
      const queues = await client.command<PlayerQueue[]>("player_queues/all");
      queueId = (queues ?? [])[0]?.queue_id;
      if (!queueId) return;
      const pls = await client.command<{ uri: string }[]>("music/playlists/library_items");
      const pl = (pls ?? []).find((p) => p.uri.startsWith("library://playlist/"));
      if (!pl) return;

      await client.command("player_queues/play_media", {
        queue_id: queueId,
        media: pl.uri,
        option: "replace",
      });
      const items = await client.command<unknown[]>("player_queues/items", { queue_id: queueId });
      expect(Array.isArray(items)).toBe(true);
    } finally {
      if (queueId) await client.command("player_queues/clear", { queue_id: queueId }).catch(() => {});
      client.close();
    }
  });

  // E1 rename: music/playlists/update sticks for a library playlist **only**
  // with overwrite:true and the full playlist object as `update`.
  test.skipIf(!reachable)("music/playlists/update renames a library playlist (overwrite:true)", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    let plId: string | undefined;
    try {
      const created = await client.command<MediaItem>("music/playlists/create_playlist", {
        name: `wigl rename ${Date.now()}`,
      });
      plId = created.item_id;
      const rows = await client.command<MediaItem[]>("music/playlists/library_items");
      const row = (rows ?? []).find((p) => p.item_id === plId);
      expect(row).toBeTruthy();

      const newName = `wigl renamed ${Date.now()}`;
      await client.command("music/playlists/update", {
        item_id: plId,
        update: { ...row, name: newName },
        overwrite: true,
      });
      await new Promise((r) => setTimeout(r, 500));
      const after = await client.command<MediaItem[]>("music/playlists/library_items");
      expect((after ?? []).find((p) => p.item_id === plId)?.name).toBe(newName);
    } finally {
      if (plId)
        await client
          .command("music/library/remove_item", { media_type: "playlist", library_item_id: plId })
          .catch(() => {});
      client.close();
    }
  });

  // Q2 drag-reorder: move_item pos_shift is a relative delta; move_item_end
  // sends the item to the tail. Enqueue two throwaway tracks, reorder, clean up.
  test.skipIf(!reachable)("move_item / move_item_end reorder the queue", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    try {
      const queues = await client.command<PlayerQueue[]>("player_queues/all");
      const q = (queues ?? [])[0];
      if (!q) return;
      const res = await client.command<SearchResults>("music/search", {
        search_query: "daft punk",
        media_types: ["track"],
        limit: 2,
      });
      const uris = res.tracks.slice(0, 2).map((t) => t.uri);
      if (uris.length < 2) return;

      const before = await client.command<{ queue_item_id: string }[]>("player_queues/items", {
        queue_id: q.queue_id,
      });
      const beforeIds = new Set(before.map((i) => i.queue_item_id));
      for (const uri of uris)
        await client.command("player_queues/play_media", { queue_id: q.queue_id, media: uri, option: "add" });

      const withNew = await client.command<{ queue_item_id: string }[]>("player_queues/items", {
        queue_id: q.queue_id,
      });
      const added = withNew.filter((i) => !beforeIds.has(i.queue_item_id));
      expect(added.length).toBe(2);

      // move the 2nd added item up one place → it should precede the 1st
      await client.command("player_queues/move_item", {
        queue_id: q.queue_id,
        queue_item_id: added[1].queue_item_id,
        pos_shift: -1,
      });
      const moved = await client.command<{ queue_item_id: string }[]>("player_queues/items", {
        queue_id: q.queue_id,
      });
      const idxA = moved.findIndex((i) => i.queue_item_id === added[0].queue_item_id);
      const idxB = moved.findIndex((i) => i.queue_item_id === added[1].queue_item_id);
      expect(idxB).toBeLessThan(idxA);

      await client.command("player_queues/move_item_end", {
        queue_id: q.queue_id,
        queue_item_id: added[1].queue_item_id,
      });

      // cleanup
      for (const i of added)
        await client.command("player_queues/delete_item", {
          queue_id: q.queue_id,
          item_id_or_index: i.queue_item_id,
        });
    } finally {
      client.close();
    }
  });

  // C3 track info panel: music/tracks/get returns the full Track — artists[] as
  // navigable objects and a metadata object (rich fields may be null without an
  // MA metadata provider, but the container keys must not have been renamed).
  test.skipIf(!reachable)("music/tracks/get returns a Track with artists[] + metadata", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    try {
      const res = await client.command<SearchResults>("music/search", {
        search_query: "daft punk",
        media_types: ["track"],
        limit: 1,
      });
      const t = res.tracks[0];
      if (!t?.item_id) return;

      const full = await client.command<MediaItem>("music/tracks/get", {
        item_id: t.item_id,
        provider_instance_id_or_domain: t.provider,
      });
      expect(full.media_type).toBe("track");
      expect(typeof full.uri).toBe("string");
      expect(Array.isArray(full.artists)).toBe(true);
      expect((full.artists ?? []).length).toBeGreaterThan(0);
      expect(typeof full.artists?.[0].name).toBe("string");
      // metadata must be an object (its individual fields are allowed to be null)
      expect(full.metadata == null || typeof full.metadata === "object").toBe(true);
    } finally {
      client.close();
    }
  });

  // P3 info panel reads streamdetails.audio_format off the current queue item.
  test.skipIf(!reachable)("queue items carry the streamdetails shape the info panel reads", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    try {
      const queues = await client.command<PlayerQueue[]>("player_queues/all");
      const withItems = (queues ?? []).find((q) => q.items > 0);
      if (!withItems) return;
      const items = await client.command<
        { streamdetails?: { audio_format?: Record<string, unknown>; provider?: string } | null }[]
      >("player_queues/items", { queue_id: withItems.queue_id, limit: 1 });
      const sd = items[0]?.streamdetails;
      if (!sd) return; // not started playing yet — no stream negotiated
      expect(typeof sd.provider === "string" || sd.provider === undefined).toBe(true);
      if (sd.audio_format) {
        // the keys TrackInfo formats — any subset may be absent, but the
        // container must be an object, not a renamed field
        expect(typeof sd.audio_format).toBe("object");
      }
    } finally {
      client.close();
    }
  });

  // Group I — "radio" is the `radio_playlist` dynamic-playlist provider,
  // addressed as `radio_playlist://playlist/<seed uri>`. startRadio navigates
  // to it; PlaylistView reads its tracks with provider "radio_playlist".
  test.skipIf(!reachable)("radio_playlist generates a dynamic mix from a seed", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    try {
      const res = await client.command<SearchResults>("music/search", {
        search_query: "radiohead",
        media_types: ["artist"],
        limit: 1,
      });
      const seed = res.artists[0];
      if (!seed) return;
      const tracks = await client.command<MediaItem[]>("music/playlists/playlist_tracks", {
        item_id: seed.uri,
        provider_instance_id_or_domain: "radio_playlist",
      });
      expect(Array.isArray(tracks)).toBe(true);
      expect(tracks.length).toBeGreaterThan(1);
      expect(typeof tracks[0].uri).toBe("string");
    } finally {
      client.close();
    }
  });
});
