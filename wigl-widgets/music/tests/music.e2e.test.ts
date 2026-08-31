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
import type { SearchResults } from "../types";

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
});
