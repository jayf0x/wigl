// Ship defaults for the music widget. Per-machine values (a non-default MA
// host, the login, a provider filter) live in the widget's Settings section,
// persisted via useStorage — not here. Backend setup is SETUP.md; the
// widget's current state / data flow is state.md.

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

/** `music/search` result cap, per media type **per provider** (the widget
 * fans out one call per enabled provider — see `useMusic.ts` `search`). No
 * "show more" affordance by design: the filter pills are how you narrow a
 * result set in a compact tile, not pagination. */
export const SEARCH_LIMIT = 10;

/** Sendspin codec: raw PCM only. Opus needs a WebCodecs `AudioDecoder` (absent
 * in WKWebView) or the WASM `opus-encdec` fallback (flaky to load in the Tauri
 * webview); Safari has no FLAC. PCM needs no decoder at all — ~1.4 Mbit/s for
 * 44.1k/16/stereo, irrelevant over localhost — so it's the one format certain
 * to produce sound here. */
export const SENDSPIN_CODECS = ["pcm"] as const;

/** How the Sendspin SDK gets audio to the output device:
 * - `"direct"` — AudioContext → destination. No extra WebKit media process,
 *   no OS media-playback entitlement needed. The SDK default on desktop.
 * - `"media-element"` — decoded PCM → MediaStream → a hidden `<audio>`. The
 *   "blessed" WebKit path and the visualiser tap point, but it spawns a
 *   media process that logs an RBS-assertion warning in an unsigned dev
 *   build (harmless in the foreground; unproven for an always-on-bottom
 *   window).
 *
 * Start on `"direct"`; if there's no sound, flip this and `widget:install`
 * (see tests/audio-check.md). */
export const SENDSPIN_OUTPUT: "direct" | "media-element" = "direct";

/** Docker container name used by Phase 4 adopt/start. Created (with
 * `--restart unless-stopped`) per `wigl-widgets/music/SETUP.md`. */
export const MA_CONTAINER = "wigl-ma";

/** The container image. `sproft/ytmusic-free-provider` is the stock Music
 * Assistant server image plus the community `ytmusic_free` provider baked in
 * (free, no-account YouTube Music) — a rolling build that tracks upstream MA.
 * Not used by the widget at runtime; here so SETUP.md and the code agree on
 * one string. */
export const MA_IMAGE = "ghcr.io/sproft/ytmusic-free-provider:latest";

export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 15_000;

/** How often to re-poll the queue snapshot as a backstop for missed events. */
export const QUEUE_POLL_MS = 10_000;

/** Optimistic transport (backlog A1): after firing a transport command the UI
 * flips locally and the triggering control is disabled until the confirming
 * `player_updated` / `queue_updated` event lands. If none arrives within this
 * window, re-read the real queue and overwrite the prediction. */
export const OPTIMISTIC_TIMEOUT_MS = 4_000;

/** Smooth playback clock (backlog A2): how often `NowPlaying` samples the
 * Sendspin SDK's live `trackProgress` while playing, to interpolate between
 * MA's sparse `queue_time_updated` events (~1 every several seconds). */
export const PROGRESS_TICK_MS = 250;
