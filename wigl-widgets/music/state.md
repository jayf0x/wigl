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
  `SENDSPIN_OUTPUT` in `music.config.ts` — `"direct"` (default; AudioContext →
  destination) or `"media-element"` (PCM → MediaStream → hidden `<audio>`;
  needed if a future feature wants a Web Audio tap — DSP, visualiser).
  `SENDSPIN_CODECS` also there. Login/creds default to `test`/`testtest`.

## Files

| File | Owns |
|------|------|
| `index.tsx` | `<Widget w=7 h=11>` root, `.music-cq` container-query wrapper, keyboard handler, offline overlay. Composes `<NowPlaying>` + `<Browser>`. |
| `useMusic.ts` | **The one hook.** Connect/reconnect (both WS), all state, every action. ~700 lines — the widget's brain. `MusicApi` interface is the contract every component uses. Owns the optimism layer (`pending` set + `markPending`/`clearAllPending`) and `getProgress()` (SDK live clock + post-seek freeze). |
| `maClient.ts` | `/ws` transport — login, message_id correlation, event fan-out, one reconnect-safe `connect()`. |
| `sendspin.ts` | `/sendspin` — authed-socket handshake + `SendspinPlayer` lifecycle + `SendspinHandle` (playerId, setVolume, `getProgress` → SDK `trackProgress`, unlock, disconnect). |
| `serverProcess.ts` | `docker start wigl-ma` when unreachable + "Auto-start server" is on. Reachability check. |
| `music.config.ts` | Ship defaults + `KEYS` (storage), `SENDSPIN_OUTPUT`, `MA_IMAGE`, `MA_CONTAINER`, timings. |
| `types.ts` | The MA shapes actually read (partial — `/api-docs` is truth). |
| `util.ts` | `providerLabel()` and small pure helpers. |
| `music.css` | `IBM Plex Mono` + `Instrument Serif` (serif = track titles only), the `.music-cq` container query, the `.music-eq` VU animation. |
| `settingsSection.tsx` | Settings-modal section: host/port/login, provider filter, auto-start toggle. |
| `components/NowPlaying.tsx` | Pinned top zone: art, title, clickable artist/album, scrubber, transport, repeat/shuffle, favourite + `⋯` (reuses `RowActionPanel` — C2), volume, the fold-down `TrackInfo` panel. Scrubber samples `api.getProgress()` every `PROGRESS_TICK_MS` while playing for a smooth clock; transport buttons disable while their action is in `api.pending`. `TrackInfo` fetches the full `music/tracks/get` via `useQuery` (`track:<uri>`) and renders clickable artist/credit chips (C3). |
| `components/Browser.tsx` | The switchable main pane: search field + `SearchFilters` + results, OR a detail view, OR `<Home>`. Hosts the nav breadcrumb. Shows a `SearchSkeleton` strip at the top of results while any provider search is still in flight; previous results stay rendered underneath. |
| `components/Home.tsx` | Tabbed default pane: Up next (`QueueList`) / Playlists / Recent / Browse (`BrowseTab`). |
| `components/QueueList.tsx` | Up-next list with pointer drag-reorder + per-row `⋯`. |
| `components/DetailView.tsx` | `ArtistView` / `AlbumView` / `PlaylistView` — the nav-stack destinations. ~310 lines. |
| `components/Row.tsx` | The universal media row + `RowAction`. Exports `standardActions`, `RowActionButtons` (inline icon shortcuts for Add-to-queue / Play-next / Favourite, container-query gated via `.music-row-inline`, + the `⋯` toggle) and `RowActionPanel` (the fold-down pill menu with submenu + inline-input support) — the last two reused by `NowPlaying`. Every list uses `Row`. |
| `components/SearchFilters.tsx` | Media-type + provider filter pills. |
| `components/BrowseTab.tsx` | `music/browse` folder navigator with its own path stack. |
| `components/Equalizer.tsx` | Decorative VU bars (NOT audio DSP). Minimized-tile background + empty states. |
| `tests/music.e2e.test.ts` | 15 live drift-regression tests vs `wigl-ma` (skip when down). |
| `tests/audio-check.md` | By-ear checklist for the DAC hop. |
| `COMPARISON.md` | M0: five real players vs this widget, capability table. |
| `SETUP.md` | Reproducible backend (Docker image, onboarding, providers, revert). |

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
longer renders it directly — it samples `api.getProgress()` (the Sendspin SDK's
`trackProgress`, a live clock computed from the last server sync + elapsed real
time) every `PROGRESS_TICK_MS` while playing, falling back to `now.elapsed`
when the SDK has no metadata yet (radio, first second). `getProgress()` also
returns the seeked target for 1.5 s after a local `seek()` so the bar doesn't
snap backward during the server rebuffer.

**Optimism (A1)**: `playPause` / `next` / `previous` / `play` (row click) flip
local state immediately, add their name to `pending`, and disable their control
until the confirming `queue*`/`player*` event lands (`clearAllPending()` +
`refreshQueue()` reconcile everything from the server snapshot) or a
`OPTIMISTIC_TIMEOUT_MS` timeout re-reads the queue. `next` predicts the jump
from `upNext[0]`. `seek` is optimistic + freeze-guarded (above). `repeat` /
`shuffle` are local-then-reconcile but not disabled (they already feel instant).

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
| Enqueue | `player_queues/play_media {queue_id, media, option:"play"|"replace"|"next"|"add"|"replace_next", radio_mode?}`. `"play"` = insert after current + skip to it (non-destructive). `radio_mode:true` **replaces the whole queue** with [seed + ~25 similar tracks] (deprecated → `radio_playlist://`; `radio_source` stays `[]`). |
| Transport | `player_queues/{play,pause,next,previous,stop,clear}` `{queue_id}` |
| Seek | `player_queues/seek {queue_id, position}` (seconds) — **works even in flow mode**, ~1 s rebuffer |
| Queue edit | `move_item {queue_id, queue_item_id, pos_shift}`, `move_item_end`, `delete_item {queue_id, item_id_or_index}`, `play_index {queue_id, index, seek_position?}` |
| Repeat/shuffle | `player_queues/repeat {queue_id, repeat_mode}`, `player_queues/shuffle {queue_id, shuffle_enabled}` |
| Playlists | `music/playlists/library_items` · `playlist_tracks {item_id, provider_instance_id_or_domain:"library"}` · `create_playlist {name}` → `library://playlist/N` · `add_playlist_tracks {db_playlist_id, uris[]}` (async; **silently ignores a playlist uri passed as a track — no merge**) · `remove_playlist_tracks {db_playlist_id, positions_to_remove[]}` · `music/library/remove_item {media_type:"playlist", library_item_id}` (delete) |
| Playlist rename | `music/playlists/update {item_id, update:{name}}` — **does not stick** for builtin-provider playlists (row re-syncs from provider). Unsolved (backlog E1). |
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
  no library management beyond playlists + favourites. (Audio effects — EQ /
  speed / reverb — are a *separate open question*, backlog group G, not a no.)
- **Responsive at any size.** Every view lays out small→large; nothing assumes
  the 7×11 default.
- Monochrome (ink-on-paper). Theme tokens only, no hardcoded colours.
- `IBM Plex Mono` + `Instrument Serif`.
- No OS media-key integration (Rust + entitlements).

## Known rough edges (see backlog-music.md for the fixes)

- Queue is destructive — one Clear and it's gone; no save/restore (group D).
- Playlist rename doesn't work (E1). Playlist-in-playlist / merge doesn't
  work via the API (E4).
