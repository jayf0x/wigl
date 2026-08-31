// Ship defaults for the music widget. Per-machine values (a non-default MA
// host, the login, a provider filter) live in the widget's Settings section,
// persisted via useStorage — not here. See todo-musicplayer.md "Phase 0" for
// where these shapes come from.

/** Music Assistant control API — REST + both WebSockets (`/ws`, `/sendspin`)
 * all live on this one port. */
export const MA_HOST = "127.0.0.1";
export const MA_PORT = 8095;

/** First-run onboarding creates this admin user; the widget then logs in as
 * it on every reconnect. Localhost-only dev credentials — overridable in
 * Settings, and the same login works at http://127.0.0.1:8095 for adding
 * providers (YouTube Music etc). MA requires an 8-char minimum password. */
export const DEFAULT_USERNAME = "test";
export const DEFAULT_PASSWORD = "testtest";

/** Storage keys (auto-prefixed with `music:` by the plugin registry). */
export const KEYS = {
  host: "host",
  port: "port",
  username: "username",
  password: "password",
  /** "" = search every enabled provider; else a MA provider instance id
   * ("radiobrowser", "ytmusic", …) to scope search to. */
  providerFilter: "provider_filter",
  /** Stable Sendspin client id == the MA player_id for this widget. Minted
   * once, reused so MA re-adopts the same player/queue across restarts. */
  clientId: "client_id",
  /** Phase 4: whether the widget may `docker start` the MA container when it
   * finds it stopped. Off by default — the owner starts MA. */
  manageServer: "manage_server",
} as const;

/** Media types the search box asks MA for, in display order. */
export const SEARCH_MEDIA_TYPES = ["radio", "artist", "album", "track", "playlist"] as const;

export const SEARCH_LIMIT = 8;

/** Sendspin codec: raw PCM only. Opus needs a WebCodecs `AudioDecoder` (absent
 * in WKWebView) or the WASM `opus-encdec` fallback (flaky to load in the Tauri
 * webview); Safari has no FLAC. PCM needs no decoder at all — ~1.4 Mbit/s for
 * 44.1k/16/stereo, irrelevant over localhost — so it's the one format certain
 * to produce sound here. */
export const SENDSPIN_CODECS = ["pcm"] as const;

/** Docker container name used by Phase 4 adopt/start. Matches the `docker
 * run --name` in todo-musicplayer.md. */
export const MA_CONTAINER = "wigl-ma";

export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 15_000;

/** How often to re-poll the queue snapshot as a backstop for missed events. */
export const QUEUE_POLL_MS = 10_000;
