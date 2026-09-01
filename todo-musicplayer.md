# Music widget — backlog

The `music` widget plays and controls a **local Music Assistant (MA) server**.
Core playback (radio + free YouTube Music), search, queue, now-playing, and the
Settings section are **built and working** (`wigl-widgets/music/`). This file is
the feature backlog for turning it from "plays music" into a full modern
player — same shape and rules as the repo `backlog.md`:

- Every entry is a problem someone can pick up and finish in one sitting.
- **One clear next step per entry**, not a menu of options.
- When it's done, **delete the entry** (git history is the changelog). Check
  the box only while it's mid-flight.
- No dates, no "as of this session". Describe the target state, not the history.
- Entries are grouped by area and numbered per group (`R1`, `P1`, …); numbers
  aren't stable — reference an entry by its title if you point at it elsewhere.

**M0 (compare with real players) is done** — see `wigl-widgets/music/COMPARISON.md`
for the capability table and the five reference players (cloned into
`.idea/refplayers/`). This backlog was rewritten from it. Take entries roughly
top to bottom; the **infra section (X) comes first** because most feature
entries hang off it — build the shared piece before its second consumer.

## Design rules for every entry

- **The scope is a music player, nothing more.** The owner: "I really just
  want a music player to replace listening to YouTube via an app." No lyrics,
  no visualiser, no EQ, no library management beyond playlists + favourites.
  If a feature isn't something the YouTube-Music app or a normal desktop
  player has, it's probably out.
- **Responsive at any size — do not design to a fixed tile.** The owner:
  "just make this widget bigger. Do not rely on defaults, make it work
  anywhere." Every view must lay out sensibly from a small tile up to a large
  one: art scales, lists fill available height, controls wrap or collapse,
  nothing clips or overflows the panel. Bump the first-launch default up
  (try `w={7} h={11}` and adjust by eye — check it doesn't collide with other
  widgets' defaults, `wigl-widgets/*/index.tsx`), but the layout must not
  *assume* that size. Test each view narrow and wide before committing.
- **Views replace, they don't stack.** The nav stack (X1) swaps the main pane;
  now-playing stays pinned. Never add a third vertical zone.

---

## Reference — the knowledge not to re-derive

**Backend setup / day-to-day / revert:** `wigl-widgets/music/SETUP.md`. The
`wigl-ma` Docker container runs `ghcr.io/sproft/ytmusic-free-provider` (stock
MA 2.10.1 + a free no-account YouTube Music provider). Providers configured:
`builtin`, `radiobrowser`, `ytmusic_free`. Admin login `test` / `testtest`,
same at `http://127.0.0.1:8095`.

**Live source of truth for every command shape:**
`http://127.0.0.1:8095/api-docs/commands.json` (and `/api-docs/openapi.json`
for REST + model schemas). Don't guess API shapes — read them there against the
running server. The REST `POST /api` envelope returns a bare JSON value (a list
or object), **not** `{result: …}` — the `/ws` envelope is `{message_id, result}`.

**Widget ↔ MA, two WebSockets on port 8095:**

- **Control** `ws://…/ws` — server sends a ServerInfo frame first, client then
  sends `{message_id, command:"auth", args:{token}}` and waits for
  `{message_id, result:{authenticated:true}}`. Commands:
  `{message_id, command, args}` → `{message_id, result}` or
  `{message_id, error_code, details}`. Events (no `message_id`):
  `{event, object_id, data}`. Token from `POST /auth/login`
  `{provider_id:"builtin", credentials:{username,password}}` (short-lived,
  re-login on every reconnect). `POST /setup` does first-run onboarding.
- **Sendspin audio proxy** `ws://…/sendspin` — first client frame
  `{type:"auth", token, client_id}` → `{type:"auth_ok"}`, then the Sendspin
  protocol is proxied bidirectionally. The widget hands this socket to
  `@sendspin/sendspin-js`'s `SendspinPlayer` (`webSocket` option), no
  `window.WebSocket` patching. `player.clientId` **is** the MA `player_id`,
  and MA auto-creates a queue with the same id.

**Audio is Sendspin, not an `<audio>` flow stream.** `codecs:["pcm"]` (WKWeb
View has no usable opus/flac decoder). Output mode is the `SENDSPIN_OUTPUT`
toggle in `music.config.ts` (`"direct"` default / `"media-element"`). The
visualiser seam is `DecodedAudioChunk` (Float32 PCM per channel) off the SDK,
not an `AnalyserNode`.

**API cheatsheet** (verify each against `/api-docs` before use):

| Need | Command |
|------|---------|
| Search | `music/search {search_query, media_types[], limit, providers[]?}` → `SearchResults` |
| Browse a provider | `music/browse {path}` — root returns provider folders; each → `Artists/Albums/Tracks/Playlists` folders. `music/recommendations` is empty until the library has content — don't build discovery on it. |
| Recently played | `music/recently_played_items {limit, media_types[]?}` → `ItemMapping[]` (server-side history, real items) |
| Queue snapshot | `player_queues/get {queue_id}` (→ `PlayerQueue`, has `flow_mode`, `repeat_mode`, `shuffle_enabled`, `current_index`), `player_queues/items {queue_id, limit, offset}` (→ `QueueItem[]`, each has `streamdetails`, `queue_item_id`) |
| Enqueue / play | `player_queues/play_media {queue_id, media:<uri or item>, option:"replace"|"next"|"add"|"replace_next", radio_mode?}`. `QueueOption` enum = `play/replace/next/replace_next/add`. `radio_mode` is deprecated → prefer a `radio_playlist://` dynamic playlist, but still works. |
| Transport | `player_queues/{play,pause,next,previous,stop,clear}` `{queue_id}` |
| Queue edit | `player_queues/move_item {queue_id, queue_item_id, pos_shift}` (`pos_shift:0` = make next), `move_item_end {queue_id, queue_item_id}`, `delete_item {queue_id, item_id_or_index}`, `play_index {queue_id, index, seek_position?}` |
| Repeat / shuffle | `player_queues/repeat {queue_id, repeat_mode:"off"|"one"|"all"}`, `player_queues/shuffle {queue_id, shuffle_enabled:bool}` |
| Seek | `player_queues/seek {queue_id, position}` (seconds) — **works** (tested, both directions, even in flow mode — see S1) |
| Volume | Sendspin-local via `player.setVolume` (this is the widget's own player). Server-side would be `players/cmd/volume_set {player_id, volume_level}` (0-100). |
| Image | `http://…:8095/imageproxy/<proxy_id>` (proxy_id is on `metadata.images[]`) |
| Playlists | `music/playlists/library_items` (list), `music/playlists/playlist_tracks {item_id, provider_instance_id_or_domain:"library"}` (read), `music/playlists/create_playlist {name}` (→ editable `library://playlist/N`), `music/playlists/add_playlist_tracks {db_playlist_id, uris[]}` (async BackgroundTask), `music/playlists/remove_playlist_tracks {db_playlist_id, positions_to_remove[]}`, `music/playlists/update {item_id, update}` (rename), `music/library/remove_item {media_type:"playlist", library_item_id}` (delete — `music/playlists/remove` 500'd in testing) |
| Favourites | `music/favorites/add_item {item:<uri or item>}`, `music/favorites/remove_item {media_type, library_item_id}`. `Track.favorite` is on the object. |
| Artist / album | `music/artists/get`, `music/artists/top_tracks`, `music/artists/artist_albums`, `music/artists/similar_artists {item_id, provider_instance_id_or_domain}`, `music/albums/album_tracks {item_id, provider_instance_id_or_domain}` |
| Events to subscribe | `queue_updated`, `queue_time_updated` (bare number), `queue_items_updated`, `player_updated`. History is a poll of `recently_played_items`, not an event. |

**Locked decisions — do not relitigate:**

- Music Assistant, not a from-scratch player, not Mopidy, not a widget-side
  yt-dlp stack. (The old "fallback stack" idea is dead — see git log for why.)
- Free YouTube via the `sproft/ytmusic-free-provider` image, not MA's paid
  built-in provider.
- Theme tokens only, no hardcoded colours (`docs/theming.md`). **M0 verdict:
  stay monochrome (ink-on-paper).** The one optional exception is the
  now-playing progress fill once it's a live scrubber — an accent there is fine
  if it reads well, not required.
- `IBM Plex Mono` + `Instrument Serif` (the serif is track titles only).
- No global media-key / OS now-playing integration (Rust + entitlements —
  separate, big). No visualiser/EQ-DSP/scrobble/offline/multi-room in the
  widget (see COMPARISON.md "cut" rows).

**Current file layout** (`wigl-widgets/music/`): `index.tsx` (root),
`useMusic.ts` (the one hook — connect, state, all actions), `maClient.ts`
(`/ws`), `sendspin.ts` (`/sendspin` + SDK), `serverProcess.ts` (`docker
start`), `music.config.ts`, `types.ts`, `music.css`, `settingsSection.tsx`,
`components/` (`NowPlaying`, `Browser`, `Equalizer`), `tests/`
(`music.e2e.test.ts`, `audio-check.md`), `COMPARISON.md` (M0 output).

**What's already done:** connect + reconnect (control + audio), search
(provider-agnostic, live/debounced), now-playing with art, up-next list,
play/pause/next/prev/clear, play-now vs add-to-queue, "start radio from this",
inline volume, offline/empty/error states, `/` + space keys, the
"＋ add youtube music" footer, the Settings section, `docker start` auto-recover.

---

## X — Infra (build these before their second consumer)

### X1 — In-widget navigation (view stack)

Artist/album/playlist/history/discovery views all need one shared piece: a
`view` state (`"browse" | "artist" | "album" | "playlist" | "history"` + the
target id/uri), a back affordance, and a header that reflects where you are.
Views **replace** the browser pane, they don't stack on top of now-playing —
so the tile stays usable. Plain reducer in `useMusic.ts` (or a tiny `useNav`),
no router lib. One next step: add the reducer + a `<BrowserHeader>` with a back
chevron + breadcrumb, wired so `browse` is the default and the existing search
UI lives under it. Land it with I1 (the first consumer).

### X2 — `useQuery` for expensive reads

Artist pages, album track lists, playlist contents, browse rows — cache them
with `@/wigl/hooks`' `useQuery` (`useSql: true` for the persist-worth ones)
keyed by the entity uri, rather than refetching on every navigation. Not a
separate task — adopt it as I1 / P1 / D1 get built, and note here which keys
ended up persisted.

### I2 — Row-action model (the `⋯` menu)

One consistent model for result/queue/playlist rows, from COMPARISON.md's read
of feishin + nuclear:

- **left-click** = play now (non-destructive, see Q1)
- **one `⋯` button** opens a compact menu: Play next · Add to queue · Add to
  playlist (needs P1) · Go to artist / album (needs I1) · Favourite · Start
  radio · Remove from queue (queue rows only) · Move to top / bottom (queue
  rows only, needs Q2's commands)
- right-click on the widget body stays the OS menu (`docs/widgets.md`) — the
  trigger is the in-content `⋯` button, never a context-menu handler

One next step: build a `<RowMenu>` component (a `@coss/dropdown-menu` or a
plain popover-free fold — check what's already in `src/components/ui/`), take
`actions: {label, icon, run, hidden?}[]`, and swap the current hover-icons in
`Browser.tsx`'s `Row` for it. Wire only the actions whose commands exist today
(play next, add to queue, favourite, start radio, remove); the rest light up
as their entries land. Add its e2e assertion for `favorites/add_item`.

---

## P — Playback controls

### P1 — Repeat & shuffle toggles

Missing entirely today. Two toggle icons by the transport row.
`player_queues/repeat {queue_id, repeat_mode:"off"|"one"|"all"}` (cycle on
click, icon reflects state), `player_queues/shuffle {queue_id, shuffle_enabled}`.
`PlayerQueue` already returns `repeat_mode` + `shuffle_enabled` — read them into
`now`/a new bit of state in `refreshQueue`. e2e: assert both commands' shapes.
Independent, small — good warm-up entry.

### P2 — In-track seek (click / drag the timeline)

**Resolved:** `player_queues/seek {queue_id, position}` (position in seconds)
**works** against the live Sendspin player — tested both directions
(43s→90s and 10s→12s), and it works **even though the queue is `flow_mode:true`**
(MA re-encodes the flow stream from the seek point; ~1s rebuffer gap on the
jump, no track change). `player_queues/play_index {queue_id, index,
seek_position}` also exists for jump-to-track-at-offset.

One next step: make `NowPlaying.tsx`'s progress bar an interactive scrubber —
pointer-down + drag sets a local "seeking to" position (freeze the
`queue_time_updated` follow while dragging), pointer-up calls
`api.seek(seconds)`. Hide it for radio (`now.isRadio`). Add `seek` to
`useMusic.ts` and the `←`/`→` keys (I3). e2e: assert `player_queues/seek`
accepts `{queue_id, position}` and the elapsed time moves.

### P3 — Expandable "more info" panel

An info icon on the now-playing bar that folds down a compact panel, collapsed
by default, `useStorage`-persisted. Content, smallest useful set:
`QueueItem.streamdetails` (codec, sample rate, bit rate, loudness — live on the
current item), `Track.metadata` (genre, description, external links),
`Album.year`, the source provider. One next step: add a `music/tracks/get` (or
reuse the queue item's `streamdetails`) read behind `useQuery`, render a
key/value list. Independent of P2.

---

## Q — Queue & playlists

### Q1 — Non-destructive play + explicit clear

Left-click a search result currently does `play_media {option:"replace"}` —
wipes the queue. Change the default to `option:"replace_next"` (play now, keep
the tail), and make the existing "Clear" button in the up-next header the only
thing that empties the queue. One next step: verify `replace_next` semantics
against `/api-docs` (does it keep items *after* current, or replace the current
+ tail?), then rewire `play()` in `useMusic.ts` and the row click in
`Browser.tsx`. e2e: assert the `QueueOption` value is accepted and the queue
length grows rather than resets.

### Q2 — Queue row actions: remove, move, drag-reorder

Each up-next row gets: remove (`player_queues/delete_item {queue_id,
item_id_or_index}`), and drag-to-reorder → `player_queues/move_item {queue_id,
queue_item_id, pos_shift}` / `move_item_end`. Pointer-based drag (no dnd lib —
small list; `Desktop.tsx` has the pointer-drag pattern). Optimistic local
reorder, reconcile on the next `queue_items_updated`. "Move to top / bottom"
comes free once the commands are wired — expose them in the I2 `⋯` menu.
e2e: assert `move_item` + `delete_item` shapes.

### P4 — Playlists: read path (list + view)

Read-only first. `music/playlists/library_items` → the user's playlists (skip
or visually separate the non-editable `is_editable:false` smart playlists like
"All favorited tracks"). Selecting one → a `playlist` view (X1) showing
`music/playlists/playlist_tracks {item_id, provider_instance_id_or_domain:
"library"}`, each track a normal row (left-click plays, `⋯` menu). A "Play all"
/ "Add all to queue" header button = `play_media` with the playlist uri.
`useQuery` the track list. e2e: assert `library_items` + `playlist_tracks`
shapes.

### P5 — Playlists: write path (create / add / remove / rename / delete)

Builds on P4. `create_playlist {name}` (→ editable `library://playlist/N`,
verified), `add_playlist_tracks {db_playlist_id, uris[]}` (async — show a brief
"added" toast, reconcile on refetch), `remove_playlist_tracks {db_playlist_id,
positions_to_remove[]}` (positions are the provider playlist positions from
`playlist_tracks`), `update {item_id, update:{name}}` for rename,
`music/library/remove_item {media_type:"playlist", library_item_id}` for
delete. The "Add to playlist" action in the I2 `⋯` menu (wired from search
rows, queue rows, and now-playing) is part of *this* entry, not a separate one.
e2e: create → add → read-back → delete round-trip (clean up after itself).

---

## H — History & discovery

### H1 — Recently played view

A "Recent" view (X1) listing `music/recently_played_items {limit:50}` — real
server-side items, newest first, each one-click re-playable via its uri. No
local log needed. Optionally filter to `media_types:["track","radio"]`. One
next step: add the command to `useMusic.ts`, a view + a nav entry to reach it.
e2e: assert the command returns `ItemMapping[]` with `uri` + `media_type`.

### H2 — Search history

Local. Recent search queries as tappable chips under the search field when it's
focused and empty. `useStorage`, cap ~20, most-recent-first, dedup. Small,
fully independent — good filler entry.

### D1 — Search filters + discovery browse

Two things, same area:

- **Filter pills** above results: which `media_types` to include
  (radio/tracks/artists/albums/playlists) and which `providers`. Both are
  already `music/search` params — this is UI + threading them through +
  persisting the last-used set. No server sort param; sort client-side if it's
  worth it (probably skip).
- **Browse home**: when the search box is empty, show a `music/browse` folder
  navigator (root → provider → Artists/Albums/Tracks/Playlists) instead of only
  up-next. Uses X1 for the folder drill-down. `music/recommendations` is empty
  on a fresh library — do **not** use it.

One next step: build the filter pills first (small, self-contained), then the
browse navigator as a second pass. e2e: assert `music/browse` root + one
provider path.

---

## I — Interaction

### I1 — Clickable artist / album

Artist and album names in results, the queue, and now-playing become links.
Artist link → an `artist` view (X1): `music/artists/get` + `top_tracks` +
`artist_albums` + a "Start artist radio" button + `similar_artists`. Album link
→ an `album` view: `music/albums/album_tracks`. This is the **first X1
consumer** — land the nav stack here. Unblocks the "Go to artist/album" action
in the I2 menu. `useQuery` every fetch. e2e: assert `artists/get` +
`artist_albums` + `album_tracks` shapes.

### I3 — Keyboard

Extend `/` + space with: `←`/`→` seek ±5s (needs P2), `n`/`p` next/prev,
`↑`/`↓` move focus in the visible list, `enter` play the focused row, `a` add
it to the queue. Scope to what fits — no global capture. One next step: extend
the `onKey` handler in `index.tsx`, add a `focusedIndex` to the browser list.
Do this last, after the list views exist to navigate.

---

## Out of scope

- **Lyrics** — **cut by the owner.** "I dont need lyrics. Only music player…
  I really just want a music player to replace listening to YouTube via an
  app." Don't build it, don't re-propose it. (`metadata/get_track_lyrics` is
  also fragile — 500s on non-library tracks.)
- **Visualiser** — seam kept (`DecodedAudioChunk`); polish, not a gap.
- **EQ / DSP, crossfade, gapless** — MA-side config, not widget UI.
- **Downloading / offline** — different product.
- **Local library** (Navidrome/Jellyfin via MA's Subsonic provider) — provider
  config; works today if the owner adds it.
- **Scrobbling** (Last.fm / ListenBrainz) — MA-side provider config.
- **OS media-key / now-playing-widget integration** — Rust + entitlements.
- **Multi-room / multiple players** — the widget drives its own one player.
- **Sleep timer** — `players/sleep_timer/set` exists; low priority.
