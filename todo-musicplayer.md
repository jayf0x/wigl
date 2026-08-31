# TODO — Music player widget

Build plan for the next agent. Direction is decided; this is the brief.
Read `AGENTS.md` and `docs/widgets.md` first.

## Goal

A `music` wigl widget that **plays music from a streaming source, inside the
widget** — no ads, no tracking, macOS, audio only. Search + radio discovery is
part of core. **One source to start: YouTube Music.** More sources, downloading,
and a visualizer are later — leave seams, don't build them.

## Architecture

```
wigl `music` widget (webview)
   │  WebSocket  ws://127.0.0.1:8095/ws   ← control: search, queue, play, now-playing
   │  HTTP audio http://127.0.0.1:8097/…  ← <audio> element plays the flow stream
   ▼
Music Assistant server  (local, `mass` or Docker)
   └─ provider: YouTube Music
```

The widget is a **player + control surface for a local Music Assistant server**.
MA owns search, the queue/playlist state machine, scrobbling, gapless flow
streaming, YouTube extraction. The widget owns the UI and (Phase 4) the server
process lifetime.

Decisions already made — do not relitigate:

- **Music Assistant**, not a from-scratch player, not Mopidy (plays audio in its
  own process → no path to a visualizer; `mopidy-youtube` lags yt-dlp fixes),
  not Jellyfin/Navidrome (own-library only, no streaming discovery — those are
  the future *local library* option and plug into MA via its Subsonic provider).
- `.idea/ytsms` was a YouTube subscription tracker with zero playback code —
  deleted.

## Music Assistant — verified on this machine (2026-08-31, Python 3.14.4)

- **Requires Python 3.14** (`requires-python = ">=3.14"`). This machine has
  3.14.4. Good — no pyenv juggling.
- **Not on PyPI.** Install options:
  - **Docker (recommended for first run):** `ghcr.io/music-assistant/server:latest`.
    Bundles everything. Docker Desktop on macOS has no host networking — fine
    here, just publish ports `8095` and `8097`. Set the Streams publish IP to
    `127.0.0.1` (see below).
  - **venv:** `python3.14 -m venv .venv && .venv/bin/pip install
    "music_assistant @ git+https://github.com/music-assistant/server@2.10.1"`
    — then **also `pip install hass-client`** (the 2.10.1 standalone install is
    missing this dep; without it `mass` crashes with
    `ModuleNotFoundError: No module named 'hass_client'`). Venv is **~1.2 GB**
    (torch/torchaudio/librosa — see next point). `ffmpeg` already on machine.
- **torch + torchaudio + librosa are hard dependencies, not optional extras** —
  they power built-in audio analysis / smart crossfades. You cannot install MA
  without them and there is no "add later". `mass --safe-mode` runs core-only
  (no providers) so it is not a way to skip them. Owner's call: stick with
  defaults, accept the footprint. (If the 1.2 GB / torch dependency ever
  becomes unacceptable, the alternative is the fallback stack at the bottom.)
- Entry point `mass -c <data-dir> --log-level info`. Boots in ~2s.
- **Two ports:** `:8095` = web + WebSocket API + Vue frontend; `:8097` =
  **streamserver** (serves audio to players). The streamserver advertises an IP
  to players — on this machine it auto-picked the LAN IP. **Set it to
  `127.0.0.1`** in Settings → System → Streams (publish IP) so the widget plays
  from localhost.
- **First run needs onboarding:** `/` 302-redirects to `/setup`. `/info`
  returns server JSON with no auth. Onboarding creates the admin user.
- **Auth exists** (auto-generated JWT secret, one builtin username/password
  provider). The widget must obtain and hold a token for `/ws`. Figure out the
  exact flow in Phase 0 (localhost bypass? long-lived token? mint via `/auth`?).
- mDNS on `:5353` errors on this machine (`No route to host`) — noisy log, not
  fatal; only affects LAN player discovery, which the web player doesn't use.
  Disable zeroconf/discovery if MA has a flag for it.

## Phase 0 — DONE (2026-08-31, agent). Backend proven. Widget built.

Ran MA 2.10.1 in Docker, onboarded, added **RadioBrowser** + **YouTube Music
(Free)** (`ytmusic_free`) — both zero-credential. Search and playback verified
live for both, including a full YouTube track playing through the widget's
Sendspin player. The findings:

### How MA runs here

**Setup + day-to-day + revert live in `wigl-widgets/music/SETUP.md` now** —
the short version: a `wigl-ma` Docker container on the
`ghcr.io/sproft/ytmusic-free-provider` image (stock MA + a free-YouTube-Music
provider baked in), ports `8095`/`8097`, data in `.idea/ma-data/`.

- Data/config persists in `.idea/ma-data/` (gitignored). Onboarded admin user
  is **`test` / `testtest`** (localhost-only dev creds — MA enforces an 8-char
  minimum, so plain `test`/`test` is rejected; change both in the widget's
  Settings section if you like). Same login works at `http://127.0.0.1:8095`.
- Boots in ~15 s on first run (downloads a torch beat-detection checkpoint
  once). `GET /info` → 200 with `onboard_done` once set up.
- **Docker Desktop wedged once during setup** — container start/rm hung for
  minutes, then recovered on its own. If `docker` CLI calls hang, the daemon
  still answers read calls on the unix socket; a Docker Desktop restart clears
  it. Noted in `global-deps.md`.
- mDNS/zeroconf errors in the log (`:5353 No route to host`) — harmless, only
  LAN player discovery, which this setup doesn't use.

### Auth (`/ws` **and** `/sendspin`)

- `POST /auth/login` `{"provider_id":"builtin","credentials":{"username","password"}}`
  → `{"success":true,"token":"<jwt>"}`. Short-lived (30-day sliding). The
  widget logs in on every (re)connect and uses the fresh token — nothing
  sensitive persisted except the username/password in Settings.
- `POST /setup` `{"username","password","display_name"}` does first-run
  onboarding and also returns a token. `GET /info` tells you if it's needed
  (`onboard_done`).
- **WS control** — `ws://127.0.0.1:8095/ws`. Server sends a ServerInfo frame
  first; client then sends `{"message_id","command":"auth","args":{"token"}}`
  and waits for `{"message_id","result":{"authenticated":true}}`. After that,
  every command is `{"message_id","command":"<cmd>","args":{…}}` →
  `{"message_id","result":…}` or `{"message_id","error_code":N,"details":"…"}`.
  Events (no message_id): `{"event":"<type>","object_id":"…","data":{…}}`.
- **Sendspin audio proxy** — `ws://127.0.0.1:8095/sendspin`. First frame from
  the client: `{"type":"auth","token":"<jwt>","client_id":"<stable id>"}` →
  server replies `{"type":"auth_ok"}`, then proxies the Sendspin protocol
  bidirectionally to MA's internal sendspin server.

### Audio: it's Sendspin now, not an `<audio>` flow stream

**The brief's `<audio src="http://…:8097/…">` assumption is stale.** MA's
built-in web player is **Sendspin** (`@sendspin/sendspin-js`, a push-PCM /
Web-Audio protocol — time-synced, gapless). `:8097` still exists (HTTP flow
stream for Chromecast/DLNA/etc.) but there is no supported "give me a browser
`<audio>` URL for a queue" path any more.

What the widget does instead (verified API shapes, built):

- bundles **`@sendspin/sendspin-js@5.0.0`** (the exact version MA 2.10.1's
  bundled frontend `2.17.297` pins — matched on purpose).
- `new SendspinPlayer({ webSocket: <the authed /sendspin socket>, productName:
  "Web Player", codecs:["pcm"], correctionMode: "quality-local", … })`, then
  `player.connect()`.
  - Passing our own `webSocket` avoids monkey-patching `window.WebSocket` (the
    MA frontend does that; a wigl widget must not — shared realm).
  - **`codecs:["pcm"]`** — opus needs a WebCodecs `AudioDecoder` (absent in
    WKWebView) or the WASM `opus-encdec` fallback (which doesn't even resolve
    under a bare `bun` script, let alone reliably in the webview); Safari has
    no FLAC. Raw PCM needs no decoder and ~1.4 Mbit/s is nothing over
    localhost. This was the likeliest cause of round-1 silence.
  - **Output mode** is `SENDSPIN_OUTPUT` in `music.config.ts` — `"direct"`
    (AudioContext → output, SDK default, no extra media process) or
    `"media-element"` (PCM → MediaStream → hidden `<audio>`, WebKit's blessed
    path + the visualiser tap). Ships on `"direct"`; `tests/audio-check.md`
    covers flipping it if there's no sound.
- Auto-pairs with no operator step: after `connect()`, send
  `sendspin/pair_web_player {"pairing_token": player.pairingToken}`. Server
  also `_auto_trust_guest_access`-es a `productName:"Web Player"` client, so
  playback works even before the pair call resolves.
- `player.clientId` **is** the MA `player_id`. MA auto-creates a queue with
  the same id. Playback: `player_queues/play_media {"queue_id": clientId,
  "media": "<uri>", "option": "replace"}`.
- **Seeking within a track does not work** (flow-mode limitation, as the brief
  warned) — next/prev/queue reorder do. The widget shows elapsed/duration as
  display only, no scrubber.
- **Visualizer seam kept**: `correctionMode` aside, sendspin-js exposes
  `DecodedAudioChunk` (raw PCM Float32 per channel) — the future visualizer
  taps that, not an `AnalyserNode` on an `<audio>` element. No CORS concern
  because the PCM never crosses an origin (it's inside the WS).

### Search / browse / now-playing (all provider-agnostic)

- `music/search {"search_query","media_types":["radio","track","artist",…],
  "limit","providers":["radiobrowser"]?}` → `SearchResults` (`radio[]`,
  `tracks[]`, …). Each item has `uri` (e.g. `radiobrowser://radio/<id>`),
  `name`, `metadata.images[]` (`.path` + `.proxy_id`).
- Image proxy: `http://127.0.0.1:8095/imageproxy?path=<url-enc path>&provider=<prov>&size=<px>`
  (widget uses this so remote art loads without tainting anything).
- `music/browse {"path":"radiobrowser://popularity"}` for discovery.
- `music/recommendations` → library-based rows (empty on a fresh install).
- Now-playing/queue: subscribe to `queue_updated` / `queue_time_updated` /
  `player_updated` events; `player_queues/get {"queue_id"}` and
  `player_queues/items {"queue_id"}` for the snapshot.
- Controls: `player_queues/{play,pause,next,previous,clear}` `{"queue_id"}`,
  `player_queues/play_media` with `"radio_mode":true` for "start radio from
  this", `players/cmd/volume_set {"player_id","volume_level"}`.

### YouTube Music — done, free, no account

MA's *built-in* YouTube Music provider requires a **paid** YouTube Music
subscription + a browser cookie + a PO-token server (it's an explicit MA
policy check, `_user_has_ytm_premium()`, not a Google API wall). Rejected.

Instead the `wigl-ma` container runs `ghcr.io/sproft/ytmusic-free-provider`
(stock MA + the community `ytmusic_free` provider: `ytmusicapi` for search,
`yt-dlp` for streams, anonymous). Added the same way as any provider,
no credentials. `SETUP.md` has the how and the tradeoffs. The widget is
provider-agnostic — search picks it up with zero code change; the
"＋ add youtube music" footer only shows if no `ytmusic*` provider is
configured.

### The `/api-docs` reference

The running server publishes the full command list at
`http://127.0.0.1:8095/api-docs/commands.json` and REST routes at
`/api-docs/openapi.json`. That's the source of truth for any command shape,
not this file.

## Phases 1–3 — DONE. `wigl-widgets/music/` is built, installed, verified.

```
wigl-widgets/music/
  index.tsx            # <Widget> root — status dot, now-playing, browser
  useMusic.ts          # the hook: connect flow, state, all actions
  maClient.ts          # /ws control client (login, message_id correlation, events)
  sendspin.ts          # /sendspin audio — authed socket → @sendspin/sendspin-js
  serverProcess.ts     # Phase 4: reachability check + `docker start` (opt-in)
  music.config.ts      # ship defaults; per-machine values → Settings
  types.ts             # the MA shapes actually read
  music.css            # IBM Plex Mono + Instrument Serif, the VU-bar animation
  settingsSection.tsx  # host/port/login, search-provider filter, auto-start toggle
  components/           # NowPlaying, Browser, Equalizer
  package.json         # deps: @sendspin/sendspin-js@5.0.0 · perms: storage, command
```

- **Phase 1** — control WS + Sendspin audio, config→effect→transport→state→
  render, no query lib. `command` permission is for Phase 4's `docker start`
  only; `ws://` and `fetch` to localhost need no Tauri capability.
- **Phase 2** — now-playing (art via `/imageproxy/<proxy_id>`, elapsed/duration
  display-only), up-next list, play/pause/next/prev/clear, play-now vs
  add-to-queue, "start radio from this" (`radio_mode: true`).
- **Phase 3** — offline/empty/error states (`ErrorOverlay`), `/` focuses
  search + space toggles play, WS + Sendspin reconnect with backoff, a
  Settings section. (Dropped the MP3-vs-FLAC toggle — the SDK negotiates codec
  with the browser; on WKWebView that lands on PCM over localhost, which is
  fine and not worth a knob.)

**Verified live** (headless — see F11 in `backlog.md` for the one gap): control
auth, Sendspin proxy auth, player registration with MA, `play_media`, queue
advancing, events flowing. Not verifiable without a human: that sound actually
comes out of the speakers.

## Phase 4 — DONE (minimal). `serverProcess.ts` + the "Auto-start server" toggle.

Deliberately smaller than the brief: it only `docker start`s an already-created
`wigl-ma` container when MA is unreachable and the owner flipped the Settings
toggle (off by default). It does **not** `docker run` (that needs the image +
the volume-path decision, made once by hand — see the `docker run` in the
Phase 0 section). No `shell:allow-spawn` needed — `runCmd` (execute, not spawn)
is enough for `docker start`, and `command` covers it. `global-deps.md` has the
Music Assistant entry.

## Seams for later (do not build now)

- **Visualizer:** keep the `<audio>` element reachable →
  `createMediaElementSource` → `AnalyserNode` → `<canvas>`. Needs the `:8097`
  stream to have permissive CORS (Phase 0 step 3).
- **More sources:** enable in MA config + widen the search filter. Keep
  search/results provider-agnostic from day 1 so this is config-only.
- **Local library:** Navidrome/Jellyfin + MA Subsonic provider → same widget.
- **Downloading:** `yt-dlp` shelled via `sh -c` to a cache dir, as a per-track
  action. Adds `yt-dlp` to `global-deps.md`.
- **Taste discovery:** ListenBrainz — scrobble finished plays, pull
  weekly-discovery / lb-radio, resolve each MBID via MA search.

## Fallback if Music Assistant doesn't work out

Thin `yt-dlp` glue, no backend server:

- HTML5 `<audio>` playing locally-cached files; `yt-dlp -x --audio-format opus`
  via `sh -c` to a cache dir; `ytmusicapi` (Python) for search +
  `get_watch_playlist` radio; LRU-evict the cache by mtime.
- Pros: perfect seeking, offline, small, visualizer works trivially.
- Cons: hand-build queue/prefetch/cache; own the `yt-dlp -U` treadmill; getting
  the file into the webview needs an `asset:` protocol scope + a
  `convertFileSrc` host module (~15 LOC core) or a `base64`-through-shell Blob.

## Sources

- MA API / architecture: <https://www.music-assistant.io/api/>,
  <https://developers.music-assistant.io/>,
  <https://github.com/music-assistant/server> (webserver README:
  `music_assistant/controllers/webserver/README.md`)
- MA builtin web player: <https://github.com/music-assistant/server/pull/2009>,
  <https://www.music-assistant.io/faq/stream-to/>
- MA install / Docker / standalone: <https://www.music-assistant.io/installation/>,
  <https://github.com/orgs/music-assistant/discussions/1391>
- MA YouTube Music provider: <https://www.music-assistant.io/music-providers/youtube-music/>
- yt-dlp 2026 state (fallback): <https://github.com/yt-dlp/yt-dlp/issues/16607>
- Web Audio CORS / tainted media: <https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Visualizations_with_Web_Audio_API>
- ListenBrainz APIs: <https://listenbrainz.readthedocs.io/en/latest/users/api/recommendation.html>
