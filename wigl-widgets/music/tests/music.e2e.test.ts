// Live e2e against the local Music Assistant Docker container (`wigl-ma`,
// see todo-musicplayer.md "Phase 0"). Skips — does not fail — when MA isn't
// reachable, same convention as wigl-widgets/LocalCode/tests/*.e2e.test.ts.
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

  test.skipIf(!reachable)("recently_played_items returns replayable items", async () => {
    const client = new MaClient(endpoint, () => {});
    await client.connect();
    try {
      const items = await client.command<MediaItem[]>("music/recently_played_items", { limit: 10 });
      expect(Array.isArray(items)).toBe(true);
      for (const it of items) {
        expect(typeof it.uri).toBe("string");
        expect(typeof it.media_type).toBe("string");
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
});
