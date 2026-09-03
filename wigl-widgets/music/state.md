# music widget — current state

**Live doc. Update it in the same commit as any change that moves what it
describes** (a new view, a new hook action, a changed data-flow, a new MA
command in use). A stale state.md is worse than none — the next agent trusts
it. The feature backlog is `../../backlog-music.md`; the M0 player comparison
is `COMPARISON.md`; backend setup is `SETUP.md`.

---

## What it is

A player + control surface for a **local Music Assistant (MA) server**
(`SETUP.md`). No backend of its own. MA does search, the queue state machine,
metadata, and the audio (streamed to the widget over the Sendspin web-player
protocol). The widget owns the UI and drives one MA player — its own.

## Runtime shape

```
widget (WKWebView, one JS realm shared with other widgets)
  │  ws://127.0.0.1:8095/ws        control: auth, search, queue, transport, events
  │  ws://127.0.0.1:8095/sendspin  audio: authed socket handed to @sendspin/sendspin-js
  │  http://127.0.0.1:8095/imageproxy/<id>   album art (<img> tags)
  ▼
Music Assistant (Docker container `wigl-ma`, image ghcr.io/sproft/ytmusic-free-provider)
  providers: builtin · radiobrowser · ytmusic_free (free, no account)
```

- **Control WS** — server sends a ServerInfo frame; client replies
  `{message_id, command:"auth", args:{token}}`, waits for
  `{message_id, result:{authenticated:true}}`. Then `{message_id, command,
  args}` → `{message_id, result}` / `{message_id, error_code, details}`.
  Events have no `message_id`: `{event, object_id, data}`. Token from
  `POST /auth/login {provider_id:"builtin", credentials:{username,password}}`,
  re-fetched on every reconnect. `POST /setup` for first-run onboarding.
- **Sendspin WS** — first client frame `{type:"auth", token, client_id}` →
  `{type:"auth_ok"}`, then the raw Sendspin protocol is proxied. The widget
  hands the *authenticated, open* socket to `new SendspinPlayer({webSocket})`
  — no `window.WebSocket` patching (shared realm). `player.clientId` **is**
  the MA `player_id`; MA auto-makes a queue with the same id.
- **Audio**: `codecs:["pcm"]` (WKWebView has no usable opus/flac decoder).
  Output mode is now a runtime setting (`KEYS.audioOutput`, seeded from
  `SENDSPIN_OUTPUT` in `music.config.ts`): `"direct"` (default; AudioContext →
  destination, lowest latency) or `"media-element"` (PCM → MediaStream →
  hidden `<audio>`). **The Effects tab (4-band graphic EQ + reverb) needs
  `"media-element"`** — the only mode with an `<audio>` element to tap.
  Opening the tab now **transparently switches** to `"media-element"` (no
  "enable" step); the switch reconnects the player, and the P1.2 resync net
  (`resyncRef`, below) re-asserts play/pause + repeat/shuffle/volume ~1.2 s
  after `ready` on any reconnect. The **auto-start-server toggle no longer
  reconnects at all** (P0.6 — `manageServer` read via a ref, dropped from the
  connect effect deps). `audioGraph.ts` owns the Web Audio chain; `useMusic` owns its
  lifecycle (created on connect if `audio.audioElement` exists, disposed on
  teardown). The SDK's media-element output is a `MediaStream` on
  `<audio>.srcObject`, so the chain taps it with `createMediaStreamSource`
  (WebKit gives silence for `createMediaElementSource` on a srcObject element),
  mutes the element, and resumes its `AudioContext` on tab-open / knob-move /
  unlock (P0.4). Verify by ear — `tests/audio-check.md`.
  **Playback speed is server-side** (P2): the widget sends
  `player_queues/set_playback_speed {queue_id, speed}`; MA time-stretches with
  `atempo` (pitch-preserving, wired through flow mode + elapsed-time
  correction). MA gates that command to audiobooks by one `media_type` check —
  `SETUP-files/sitecustomize.py` (mounted read-only via `PYTHONPATH`) wraps the
  method to lift it. Client-side time-stretch stays impossible (MediaStream
  source); the Sendspin transport is untouched, nothing runs at 1×. The SDK's
  `trackProgress` already scales position by `playback_speed`, so the scrubber
  needs no clock change. `useMusic` reads it back in `refreshQueue` (queue
  level, falling back to `current_item.extra_attributes.playback_speed`),
  re-asserts it after a reconnect (it's per-item + in-memory), and reverts
  optimistically if the server refuses. UI: a `Gauge` fold-out slider in
  `NowPlaying` + a tap-to-reset badge on the scrubber row, both hidden for
  radio. `SENDSPIN_CODECS` also in config. Login/creds default to
  `test`/`testtest`.

## Files

| File | Owns |
|------|------|
| `index.tsx` | `<Widget w=7 h=11>` root, `.music-cq` container-query wrapper, keyboard handler, offline overlay. Composes `<NowPlaying>` + `<Browser>`. |
| `useMusic.ts` | **The one hook.** Connect/reconnect (both WS), all state, every action. ~700 lines — the widget's brain. `MusicApi` interface is the contract every component uses. Owns the optimism layer (`optimisticRef` predictions + `pending` set + `markPending`/`pendingClear`, P1.1), the `resyncRef` reconnect safety net (P1.2), and `getProgress()` (SDK live clock + post-seek freeze). |
| `maClient.ts` | `/ws` transport — login, message_id correlation, event fan-out, one reconnect-safe `connect()`. |
| `sendspin.ts` | `/sendspin` — authed-socket handshake + `SendspinPlayer` lifecycle + `SendspinHandle` (playerId, setVolume, `getProgress` → SDK `trackProgress`, unlock, disconnect). |
| `serverProcess.ts` | Docker ops via `runCmd("sh", …)`: `maReachable`, `startMaContainer` (auto-start), and H1's `restartMaContainer` / `clearMaCache` (wipe `/data/.cache` + old logs, restart) / `updateMaImage` (inspect ports+mounts → pull → rm → recreate). Docker binary discovered from a small candidate list. |
| `music.config.ts` | Ship defaults + `KEYS` (storage), `SENDSPIN_OUTPUT`, `MA_IMAGE`, `MA_CONTAINER`, timings. |
| `types.ts` | The MA shapes actually read (partial — `/api-docs` is truth). |
| `util.ts` | `providerLabel()` and small pure helpers. |
| `pickImage.ts` | E3 — `pickImageDataUri()`: system file chooser (`osascript` / `zenity`) + `sips`/ImageMagick downscale + base64 through one `sh -c`, returns a self-contained data URI. No dialog plugin, no asset protocol; `command` permission only. |
| `playlistImage.ts` | `playlistDisplayImage(api, playlist, fallbackArt?)` — the single source of truth for a playlist's image: custom background (`api.playlistImages[id]`, E3) > MA art > first-track art (caller-supplied) > null. Used by the detail header, the Playlists-list rows, and the pinned strip so they never disagree (feedback E). |
| `music.css` | `IBM Plex Mono` + `Instrument Serif` (serif = track titles only), the `.music-cq` container query, the `.music-eq` VU animation, and the **`.mx-` motion layer** — a documented set of mechanical-feel interaction classes (`.mx-press` key-depress, `.mx-tap` async-click ring pulse, `.mx-pending`/`.mx-pending-long` in-flight shimmer, `.mx-flash` done-ack, `.mx-sync` LED blink, `.mx-enter` view transition) + standardised `--mx-*` duration/easing tokens on `.music-widget`. All `prefers-reduced-motion`-aware, theme-token driven. Applied so far in `NowPlaying` (transport/volume/ⓘ) + the Home tab bar + panel; app-wide application is a later pass. Also the **icon treatment** (feedback I): `.music-widget svg { stroke-width: 2.25px }` globally + `.mx-icon-strong` (2.5px) on the primary transport button, whose glyphs are also bumped to 18px. Line-toggle icons (repeat/shuffle) stay stroke-only — filling those glyphs blobs them. |
| `settingsSection.tsx` | Settings-modal section: host/port/login, provider filter, auto-start toggle, audio-effects path toggle, and the H1 "Backend" `OpButton`s (Restart / Clear cache / Update server). Password field uses the shared `@/components/ui/password-input` (eye toggle). |
| `FEATURES.md` | User-facing "what the non-obvious features do" (queue model, ⋯ menu, radio, playlists, search, effects, keys). Keep it current when UX changes. |
| `components/NowPlaying.tsx` | Pinned top zone: art, title, clickable artist/album, scrubber (+ P2 speed badge), transport, repeat/shuffle, favourite + `⋯` (reuses `RowActionPanel` — C2), `SpeedControl` + `VolumeControl` fold-out sliders, the fold-down `TrackInfo` panel. Transport buttons carry a hover tooltip (`@/components/ui/tooltip`, a new host
module). Scrubber samples `api.getProgress()` every `PROGRESS_TICK_MS` while playing for a smooth clock; transport buttons disable while their action is in `api.pending`. `TrackInfo` fetches the full `music/tracks/get` via `useQuery` (`track:<uri>`) and renders clickable artist/credit chips (C3). |
| `components/Browser.tsx` | The switchable main pane: search field + `SearchFilters` + results, OR a detail view, OR `<Home>`. Hosts the nav breadcrumb. Shows a `SearchSkeleton` strip at the top of results while any provider search is still in flight; previous results stay rendered underneath. |
| `components/Home.tsx` | Tabbed default pane: Up next (`QueueList`) / Playlists / Recent / Browse (`BrowseTab`). `PinnedStrip` above the tabs = horizontal quick-access chips for `api.pinnedPlaylists` (F1). |
| `components/QueueList.tsx` | Up-next list with pointer drag-reorder (P0.5: DOM order stays fixed during a drag — rows move by CSS transform so pointer capture never drops; list frozen to a snapshot for the gesture; one `moveQueueItem` on drop, `arrayMove` in `util.ts` is the shared reducer) + per-row `⋯`. `QueueHeader`: "Save" (→ `saveQueueAsPlaylist`, queue untouched; on success swaps to a flashing "saved as …" acknowledgement — feedback D) + two-step "Clear" (D2/D4). |
| `components/DetailView.tsx` | `ArtistView` / `AlbumView` / `PlaylistView` — the nav-stack destinations. `PlayPills` = the D1-toggle-aware primary play button (+ explicit "Play now" in append mode). `PlaylistView`: inline Rename (E1), Background image (E3 — `api.playlistImages` / `api.setPlaylistImage`, also replaces the header cover, feedback E), two-step Delete. Track rows capped at `PLAYLIST_RENDER_CAP`. |
| `components/Row.tsx` | The universal media row + `RowAction`. A click or double-click anywhere on the row's main area **always** plays (and closes an open `⋯` panel — feedback C), guarded against a click-then-dblclick triple fire. The inline-shortcut vs `⋯`-overflow split is measured per row in JS now (a `ResizeObserver`, `INLINE_MIN_PX`) so `RowActionPanel` can be handed an `exclude` list and never show an action that's already inline (feedback F); plain panel actions collapse to icon + `<Tooltip>` (feedback C/I). Exports `standardActions` (Play now / Play next / Add to queue / Favourite / Add-to-playlist / Merge-into (playlist rows) / "{Track,Artist,Album,Playlist} radio" → navigates to the `radio_playlist` mix / Go to artist·album), `RowActionButtons` (takes the already-resolved `inline` actions + the `⋯` toggle; `.music-row-inline` is now just `display:flex`, JS decides whether to render it) and `RowActionPanel` (the fold-down pill menu with submenu + inline-input support, `exclude?` prop, icon+tooltip for plain actions) — `RowActionPanel` is also reused by `NowPlaying`. Every list uses `Row`. |
| `components/SearchFilters.tsx` | Media-type + provider filter pills. |
| `components/BrowseTab.tsx` | `music/browse` folder navigator with its own path stack. Root level has a "＋ add a music source" footer → opens the MA web UI (F2). |
| `components/EffectsTab.tsx` | The Effects Home tab: a **4-band graphic EQ** (custom `VFader`s, peaking, ±12 dB, centre detent) + **Reverb** fader + a **Bypass (on/off)** toggle distinct from **Reset**. Auto-switches to `media-element` on mount (no enable step). Slider race fix: local `draft` for the instant visual, `api.applyFx` to the graph on rAF, `api.setFx` (persist) debounced 400 ms; faders read `draft` mid-drag, stored `api.fx` otherwise. |
| `components/VFader.tsx` | A vertical, pointer-driven fader (rail + cap + detent line + scale marks). `onChange` continuous, `onCommit` on release. Keyboard ↑/↓. `data-no-drag`, theme tokens. Used by `EffectsTab`; not shared to core (single consumer). |
| `audioGraph.ts` | The Web Audio chain (`attachAudioFx(el)` → 4 peaking bands → dry + convolver-reverb → destination) + `FxState` (`{bands[4], reverb, bypass}`) / `DEFAULT_FX` / `BAND_HZ` / `normalizeFx` (migrates the legacy `{low,mid,high,reverb,echo}` blob) / `fxIsFlat` / `fxIsActive`. Param changes ramped with `setTargetAtTime` (no zipper). Reverb IR is synthesised noise (no asset). Runs once per `<audio>` element. Echo was cut. |
| `components/Equalizer.tsx` | Decorative VU bars (NOT audio DSP — that's `audioGraph.ts`). Minimized-tile background + empty states. |
| `tests/music.e2e.test.ts` | 15 live drift-regression tests vs `wigl-ma` (skip when down). |
| `tests/audio-check.md` | By-ear checklist for the DAC hop. |
| `COMPARISON.md` | M0: five real players vs this widget, capability table. |
| `SETUP.md` | Reproducible backend (Docker image, onboarding, providers, revert, the playback-speed shim mount). |
| `SETUP-files/sitecustomize.py` | P2 — mounted read-only into the container via `PYTHONPATH`; wraps `PlayerQueuesController.set_playback_speed` to lift MA's audiobook-only gate so music tracks can be sped up. Re-check after `docker pull`. |

## Data flow

`useStorage` settings → connect effect → two WebSockets → `useState` → render.
**No `useQuery` for the queue / now-playing** — those are event-driven
(`refreshQueue()` on any `queue*`/`player*` event + a `QUEUE_POLL_MS` backstop).
`useQuery` (in-memory, keyed by entity uri, ~6h/60s stale) *is* used for the
detail views: `artist:<uri>`, `album:<uri>`, `playlist:<id>`, and the
now-playing track-info panel `track:<uri>` (full `music/tracks/get`).

**Search** (B1/B2): `search()` fans out one `music/search` per enabled provider
+ `"library"` in parallel, merging (uri-deduped) into an accumulator as each
returns. `searchGenRef` drops responses from a superseded query. `searching`
stays true until the last provider answers; `results` isn't cleared until the
first new response lands, so old results never blank.

**Nav**: `navStack` in `useMusic` — `NavView[]`, `{kind:"browse"}` is home;
`navTo` pushes (or resets to browse), `navBack` pops, `navHome` clears. Views
**replace** the Browser pane; `<NowPlaying>` stays pinned. No router.

**Now-playing / time**: `now.elapsed` is the event-seeded value from MA's
`queue_time_updated` (fires only ~once every several seconds). The scrubber no
longer renders it directly — its `Scrubber` runs a **`requestAnimationFrame`
counter** (A2) that advances a local `posRef` by real elapsed time ×
`getProgress().playbackSpeed` every frame while playing. Each frame it also
reads `api.getProgress()` (the Sendspin SDK's `trackProgress`, a live clock off
the last server sync) and reconciles: drift > 0.35 s snaps `posRef` and bumps
`syncKey` → the time label replays `.mx-sync` (a one-shot LED blink); drift
0.02–0.35 s glides in silently. The counter resets on track change and pauses
(renders `now.elapsed`) when not playing. Radio (`now.isRadio`) skips the whole
loop and shows "live". After a local `seek()` `getProgress()` returns a
playhead *projected forward* from the seek target and only hands back to the
SDK clock once that clock converges (`SEEK_CONVERGE_S`) or `SEEK_FREEZE_MAX_MS`
elapses — so the bar never snaps backward through a long rebuffer (P0.3).
`PROGRESS_TICK_MS` in config is now unused (kept as a tuning reference).

**Queue mode (D1)**: `queueMode` (`useStorage`, `"append"` default) drives
whether a plain row click / detail-view "Play" keeps the existing tail
(`"append"` → MA `"play"`) or wipes it (`"replace"`) — both start the clicked
item immediately (P0.1). Toggle lives next to shuffle/repeat in `NowPlaying`. "Play now" (`option:"play"`, insert-after-current) is always
available explicitly (row `⋯`, detail-view pill). `saveQueueAsPlaylist` copies
the live queue (`player_queues/items` → uris → `create_playlist` +
`add_playlist_tracks`) without clearing it.

**Play gesture (P0.1/P0.2)**: `play(item)` with no explicit option ALWAYS
starts the item now — `queueMode==="append"` → MA `"play"` (insert-after-current
+ skip, tail intact), `"replace"` → wipe + play, empty queue → replace. Silent
`"add"` is an explicit `⋯` / detail-pill action only. `play()` never touches
`results` or `navStack` — search, scroll and the current view stay put.

**Optimism (P1.1)**: every control predicts its result, renders it now, and
holds the prediction until the *server's own snapshot agrees* — not just until
the next event fires. `optimisticRef` carries the predicted fields (`playing`,
`repeat`, `shuffle`, an `expectId` for a track change, `holdNow`/`holdQueue`
flags); `refreshQueue` compares each against `player_queues/get` and only then
clears the matching `pending` entry. A `queue*`/`player*` event that arrives
before MA has processed the command (a volume echo mid-skip, a position tick)
no longer snaps the control back — that was the "pressed pause, waited 3 s"
bug. `markPending` still caps every hold at `OPTIMISTIC_TIMEOUT_MS` and then
trusts the server. `next` predicts from `upNext[0]`; `play` (row click) paints
a minimal `now` from the clicked item and holds on its uri; `seek` is
freeze-guarded (above). Controls show `.mx-pending` while unconfirmed; the
transport buttons also disable.

**Resync net (P1.2)**: `resyncRef` snapshots `{playing, repeat, shuffle,
volume}` in the connect effect's cleanup (before *any* teardown). ~1.2 s after
the next `ready`, `boot()` re-reads `player_queues/get` and re-asserts whatever
drifted — play/pause, repeat, shuffle, and always the user's volume (the fresh
player defaults its own). The owner's "if something ever stops the music, it at
least comes back" guarantee, covering every reconnect path.

## MA command cheatsheet

`http://127.0.0.1:8095/api-docs/commands.json` is the source of truth — always
verify a shape there against the running server before using it. What the
widget currently uses:

| Area | Commands |
|------|----------|
| Search | `music/search {search_query, media_types[], limit, providers[]?}` → `SearchResults`. `providers` takes an **instance id or a domain** (or `"library"`). One call blocks until that provider answers (radiobrowser ~0.5 s, ytmusic_free ~1–3 s cold, instant warm). The widget fans out one call **per enabled provider + `"library"`** in parallel and merges results as each returns (B1); `limit` is per-type-per-provider. |
| Browse | `music/browse {path}` — root → provider folders → Artists/Albums/Tracks/Playlists |
| Recently played | `music/recently_played_items {limit, media_types[]?}` → `ItemMapping[]` |
| Queue read | `player_queues/get {queue_id}` (→ `PlayerQueue`: `flow_mode`, `repeat_mode`, `shuffle_enabled`, `current_index`, `elapsed_time`, `current_item`), `player_queues/items {queue_id, limit, offset}` |
| Enqueue | `player_queues/play_media {queue_id, media, option:"play"|"replace"|"next"|"add"|"replace_next", radio_mode?}`. `media` accepts a uri **or a playlist uri** (loads the whole playlist). `"play"` = insert after current + skip (non-destructive); `"replace"` wipes; `"add"` appends to the tail (an idle queue is cued but not auto-started). Widget `play(item)` with no explicit option follows `queueMode` (D1): `"append"`→`"add"`, `"replace"`→`"replace"`; an empty queue always replaces. **Don't use `radio_mode`** — deprecated, and destructive (replaces the queue). |
| Radio (dynamic mix) | `radio_playlist://playlist/<seed uri>` is a generated playlist (seed's tracks + similar). Read its tracks: `music/playlists/playlist_tracks {item_id:<seed uri>, provider_instance_id_or_domain:"radio_playlist"}`. Seed types: track / artist / album / (non-dynamic) playlist / genre. `startRadio()` navigates to it as a `PlaylistView`; Play there respects `queueMode`. |
| Transport | `player_queues/{play,pause,next,previous,stop,clear}` `{queue_id}` |
| Seek | `player_queues/seek {queue_id, position}` (seconds) — **works even in flow mode**, ~1 s rebuffer |
| Queue edit | `move_item {queue_id, queue_item_id, pos_shift}`, `move_item_end`, `delete_item {queue_id, item_id_or_index}`, `play_index {queue_id, index, seek_position?}` |
| Repeat/shuffle | `player_queues/repeat {queue_id, repeat_mode}`, `player_queues/shuffle {queue_id, shuffle_enabled}` |
| Playlists | `music/playlists/library_items` · `playlist_tracks {item_id, provider_instance_id_or_domain:"library"}` · `create_playlist {name}` → `library://playlist/N` · `add_playlist_tracks {db_playlist_id, uris[]}` (async; **silently ignores a playlist uri passed as a track — no merge**) · `remove_playlist_tracks {db_playlist_id, positions_to_remove[]}` · `music/library/remove_item {media_type:"playlist", library_item_id}` (delete) |
| Playlist rename | `music/playlists/update {item_id, update:{...fullPlaylistObject, name}, overwrite:true}` — **sticks** for a `library://` playlist (E1). Both `overwrite:true` and the full object (not just `{name}`) are required; a partial `update` errors "Field item_id … is missing". |
| Playlist merge (E4) | no free merge (`add_playlist_tracks` no-ops on a playlist uri). Real path: `playlist_tracks` on the source → `add_playlist_tracks` each track uri into the target (`mergePlaylist`). |
| Favourites | `music/favorites/add_item {item:<uri>}`, `music/favorites/remove_item {media_type, library_item_id}`. `Track.favorite` on the object. |
| Artist/album | `music/artists/{get,top_tracks,artist_albums,similar_artists}`, `music/albums/album_tracks` — all `{item_id, provider_instance_id_or_domain}` |
| Track detail | `music/tracks/get {item_id, provider_instance_id_or_domain}` → `Track`. `artists[]` are navigable objects; `album` comes back `{}` (use the search-result album instead). `metadata` keys (`description, performers, label, genres, mood, style, release_date, popularity`) exist but are **null on the stock server** — they need an MA metadata provider (see backlog "Rich track metadata…"). `TrackInfo` renders whatever is present. |
| Image | `http://…:8095/imageproxy/<proxy_id>` (proxy_id on `metadata.images[]`) |
| Events | `queue_updated`, `queue_time_updated` (rare!), `queue_items_updated`, `player_updated`, `playlog_updated` (fires on track change — history signal) |

## Locked decisions

- Music Assistant backend, not a from-scratch player or a widget-side yt-dlp
  stack. Free YouTube via `sproft/ytmusic-free-provider`, not MA's paid one.
- **Scope: a music player, nothing more.** Owner: "I really just want a music
  player to replace listening to YouTube via an app." No lyrics, no visualiser,
  no library management beyond playlists + favourites. **Audio effects (4-band
  EQ + reverb) are in** (Effects tab, `media-element` output). **Playback speed
  is in** — server-side MA `atempo`, unlocked via a container
  `sitecustomize.py` patch (`SETUP.md` "Playback speed"); no client-side
  time-stretch, Sendspin transport untouched.
- **No native audio path.** `codecs:["pcm"]` over localhost is already lossless
  from MA; a Tauri audio plugin on `:8097` would only cost the Web Audio tap
  and a Rust dependency. Sendspin stays the audio transport.
- **The UI is optimistic** — every control predicts its result and holds it
  until the server's snapshot agrees (P1.1); the server (through Docker) is
  slow and the UI must
  never wait on it. Treat it as a rule for new controls — see
  `docs/architecture.md` "Optimistic UI for a laggy backend".
- **Responsive at any size.** Every view lays out small→large; nothing assumes
  the 7×11 default.
- Monochrome (ink-on-paper). Theme tokens only, no hardcoded colours.
- `IBM Plex Mono` + `Instrument Serif`.
- **Never leak dev-context into user-visible strings** ("see the backlog",
  "TODO", internal ticket ids). Happened once in the Effects tab.
- Queue-mode default is **append** — but a plain row click still **plays the
  track** (insert-and-skip, tail intact), never silent-append. Replace + Clear
  are the only queue-emptiers.
- No OS media-key integration (Rust + entitlements).

## Known rough edges → backlog-music.md has the remaining work

All P0 iteration-3 breakage is fixed (P0.1–P0.7). P1 (optimistic-UI audit +
resync net), P2 (server-side speed) and P3–P8 are still open.

**Standing:**
- Rich track metadata is null without an MA metadata provider on the server.
- Playlist background images are base64 in one `playlist_images` kv map —
  being replaced by a proper wigl image system (backlog P7).
- The `.mx-` motion layer is applied widely (Row, Home, Browser, DetailView,
  EffectsTab, QueueList, SearchFilters, BrowseTab, settingsSection + NowPlaying).
