# Music widget — backlog

The `music` widget plays and controls a **local Music Assistant (MA) server**.
Core playback (radio + free YouTube Music), search, queue, now-playing, and the
Settings section are **built and working** (`wigl-widgets/music/`). This file is
now the feature backlog for turning it from "plays music" into a full modern
player — same shape and rules as the repo `backlog.md`:

- Every entry is a problem someone can pick up and finish in one sitting.
- **One clear next step per entry**, not a menu of options.
- When it's done, **delete the entry** (git history is the changelog). Check
  the box only while it's mid-flight.
- No dates, no "as of this session". Describe the target state, not the history.
- Entries are grouped by area and numbered per group (`R1`, `P1`, …); numbers
  aren't stable — reference an entry by its title if you point at it elsewhere.

Work **M0 first** — it produces the prioritised list everything else is
measured against. Then take entries in roughly the order they're written;
several are independent and can go in any order (noted per entry).

---

## Reference — the knowledge not to re-derive

**Backend setup / day-to-day / revert:** `wigl-widgets/music/SETUP.md`. The
`wigl-ma` Docker container runs `ghcr.io/sproft/ytmusic-free-provider` (stock
MA 2.10.1 + a free no-account YouTube Music provider). Providers configured:
`builtin`, `radiobrowser`, `ytmusic_free`. Admin login `test` / `testtest`,
same at `http://127.0.0.1:8095`.

**Live source of truth for every command shape:**
`http://127.0.0.1:8095/api-docs/commands.json` (and `/api-docs/openapi.json`
for REST). Don't guess API shapes — read them there against the running server.

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
| Browse a provider | `music/browse {path}` (e.g. `radiobrowser://popularity`) |
| Recommendation rows | `music/recommendations` (library-based; empty on a fresh install) |
| Queue snapshot | `player_queues/get {queue_id}`, `player_queues/items {queue_id, limit, offset}` |
| Enqueue / play | `player_queues/play_media {queue_id, media:<uri or item>, option:"replace"|"next"|"add"|"replace_next", radio_mode?}` |
| Transport | `player_queues/{play,pause,next,previous,stop,clear}` `{queue_id}` |
| Queue edit | `player_queues/{move_item,move_item_end,delete_item,play_index}` `{queue_id, …}` |
| Repeat / shuffle | `player_queues/{repeat,shuffle}` `{queue_id, …}` |
| Seek | `player_queues/seek {queue_id, position}` — **see S1, may not work for a Sendspin player** |
| Volume | `players/cmd/volume_set {player_id, volume_level}` (0-100) |
| Image | `http://…:8095/imageproxy/<proxy_id>` (proxy_id is on `metadata.images[]`) |
| Playlists | `music/playlists/*` — `create_playlist`, `add_playlist_tracks`, `remove_playlist_tracks`, `playlist_tracks` (read `/api-docs`) |
| Library | `music/library/*` — add/remove favourites, list |
| Events to subscribe | `queue_updated`, `queue_time_updated` (bare number), `queue_items_updated`, `player_updated`, `media_item_played` (scrobble/history signal — verify) |

**Locked decisions — do not relitigate:**

- Music Assistant, not a from-scratch player, not Mopidy, not a widget-side
  yt-dlp stack. (The old "fallback stack" idea is dead — see git log for why.)
- Free YouTube via the `sproft/ytmusic-free-provider` image, not MA's paid
  built-in provider.
- Theme tokens only, no hardcoded colours (`docs/theming.md`). The widget is
  currently monochrome (ink-on-paper) — a deliberate minimalist choice, but
  **M0 may revisit** whether an accent colour earns its place.
- `IBM Plex Mono` + `Instrument Serif` (the serif is track titles only).

**Current file layout** (`wigl-widgets/music/`): `index.tsx` (root),
`useMusic.ts` (the one hook — connect, state, all actions), `maClient.ts`
(`/ws`), `sendspin.ts` (`/sendspin` + SDK), `serverProcess.ts` (Phase 4
`docker start`), `music.config.ts`, `types.ts`, `music.css`,
`settingsSection.tsx`, `components/` (`NowPlaying`, `Browser`, `Equalizer`),
`tests/` (`music.e2e.test.ts`, `audio-check.md`).

**What's already done:** connect + reconnect (control + audio), search
(provider-agnostic, live/debounced), now-playing with art, up-next list,
play/pause/next/prev/clear, play-now vs add-to-queue, "start radio from this",
inline volume, offline/empty/error states, `/` + space keys, the
"＋ add youtube music" footer, the Settings section, `docker start` auto-recover.

---

## M0 — Compare with real players, then write the roadmap

**Do this before any feature entry below.** The point is to not hand-write a
feature spec — pull real modern players, see what they do, decide what this
widget needs, and rewrite the rest of this backlog against that.

1. **Clone into `.idea/refplayers/`** (gitignored — `.idea/` is the owner's
   reference folder, see AGENTS.md "Working tips") and read each for
   interaction patterns, queue/playlist model, now-playing layout, search UX,
   and context-menu actions:
   - `music-assistant/frontend` (Vue) — the direct reference: what MA itself
     surfaces of its own API. The widget is a compact re-take of this.
   - `nukeop/nuclear` (Electron/React) — closest in spirit: no-account
     multi-source streaming, queue, playlists, lyrics, a visualiser.
   - `jeffvli/feishin` (Electron/React) — best-in-class queue / playlist /
     right-click-menu UX in the FOSS ecosystem; React patterns transfer.
   - `qier222/YesPlayMusic` (Vue) — celebrated clean now-playing + lyrics
     screen; the "beautiful minimal" reference.
   - One wildcard the researcher picks (candidates: `th-ch/youtube-music` for
     the plugin/power-feature list, `Supersonic` for keyboard-driven minimal,
     `Amberol`/`Harmonoid` for restraint, `Cider` for polish).
2. **Write `wigl-widgets/music/COMPARISON.md`**: a table of every standard
   player capability (transport, seek, queue ops, playlists, history, search
   filters/sort, lyrics, info panels, keyboard, drag, context menus, radio,
   library/favourites, discovery, visualiser, …) × {have / partial / missing /
   deliberately-cut-for-a-widget}, each row one line on *why* and, if kept, a
   sketch of the smallest version that fits a grid tile.
3. **Rewrite everything below M0** in this file from that table — merge,
   split, re-scope, cut, add. Keep it backlog-styled. The owner's original
   list (clickable artist links, watch/search history, seek, foldable info,
   search filter/sort pills, playlists + track CRUD, non-destructive queue +
   clear button, drag-reorder, "left-click actions") is the *starting* set,
   not the final one.

**Deliverable:** `COMPARISON.md` committed + this backlog rewritten. Then
proceed to the (rewritten) entries.

---

## S — Seek & now-playing

### S1 — In-track seek (click / drag the timeline to jump)

The now-playing progress bar is display-only today because MA's Sendspin web
player was assumed to be flow-mode (no per-track seek). **Resolve whether seek
is actually possible before designing the UI:** test `player_queues/seek
{queue_id, position}` against the running Sendspin player and watch whether
playback jumps (check `queue_time_updated` + listen). Also check
`player_queues/play_index {queue_id, index, seek_position}` and whether a
non-flow / per-item stream mode is selectable per player or per queue
(`/api-docs`, and the `flow_mode` field on `PlayerQueue`). One clear next
step: run that test, write the answer here, then either (a) build a
click-and-drag scrubber on the existing progress bar, or (b) if seek genuinely
can't work, cut the scrubber and note it — don't fake it.

### S2 — Expandable "more info" panel

An info icon on the now-playing bar that expands a foldable panel with
whatever MA has for the current item: full artist/album, year, genre, bitrate
/ codec / sample rate (from `streamdetails`), the source provider, a
description/bio if present, external links. Collapsed by default; state
persisted via `useStorage`. Independent of S1.

### S3 — Lyrics (if M0 says it's worth it)

MA exposes `music/get_track_lyrics` (LRCLIB + others). If M0's comparison
keeps this: a lyrics view in the expanded panel (S2), time-synced to
`queue_time_updated` when LRC timestamps are available, plain scroll
otherwise. Gate on M0.

---

## Q — Queue & playlists

### Q1 — Non-destructive "play" + explicit clear

Today clicking a search result does `play_media {option:"replace"}` — it wipes
the queue. Change the default left-click to **play-now-without-clearing**
(`option:"replace_next"` or play + keep tail — verify which MA option does
"play this now, keep everything after the current item"), and make queue
clearing an explicit button in the up-next header (a Clear already exists
there — make sure it's the *only* thing that empties the queue). One next
step: nail down the MA `QueueOption` semantics against `/api-docs`, then
rewire `play()` in `useMusic.ts` + the row click in `Browser.tsx`.

### Q2 — Drag-to-reorder the queue

Up-next rows draggable to reorder → `player_queues/move_item {queue_id,
queue_item_id, pos_shift}` (or `move_item_end`). Use a pointer-based reorder
(no new dep — small list, see `wigl-widgets/repos` / `Desktop.tsx` for
pointer-drag patterns already in the repo). Optimistic local reorder,
reconcile on the next `queue_items_updated`.

### Q3 — Per-row queue actions

Each queue row (and each search-result row) gets a small action affordance —
remove from queue (`player_queues/delete_item`), play next, add to a playlist
(needs P1), go to artist/album (needs I1). Decide left-click-opens-menu vs
hover-icons vs both from M0's comparison. Keep it one compact control, not a
row of five icons.

### P1 — Playlists: create + CRUD

Full playlist support against MA's `music/playlists/*`:

- list the user's playlists (`music/library/playlists` or `music/browse`)
- create (`music/playlists/create_playlist`)
- add a track — from a search result, a queue row, or now-playing
  (`music/playlists/add_playlist_tracks`)
- remove / reorder tracks (`remove_playlist_tracks`, and check for a reorder
  command)
- rename / delete the playlist
- play a playlist (`play_media` with the playlist uri) and "add playlist to
  queue"

This is the biggest single entry — it may want its own `Playlists.tsx`
sub-view in the widget (a third pane alongside now-playing / browser, or a
tab). M0 should sketch where it lives. One next step: read all of
`music/playlists/*` and `music/library/*` in `/api-docs`, write the exact
command list here, then build the read path (list + view) before the writes.

### Q4 — "Add queued/playing item to a playlist"

Falls out of P1 + Q3 — the "add to playlist" action wired from queue rows and
the now-playing bar. Keep as a reminder that it's a required surface, not just
a playlist-view feature.

---

## H — History

### H1 — Play history ("watch history")

A scrollable list of recently-played tracks/stations, newest first, each
re-playable in one click. Source: MA fires an event when an item finishes
(`media_item_played` / a queue event — confirm which in `/api-docs` +
by watching the live event stream). Persist locally via `useStorage` (cap ~200
entries, dedup consecutive repeats). If MA already keeps a server-side history
(`music/recently_played` or similar — check), prefer reading that and only
fall back to the local log. Independent of everything else.

### H2 — Search history

Recent search queries, shown as tappable chips under the search field when it's
focused and empty. `useStorage`, cap ~20, most-recent-first, dedup. Small,
independent.

---

## D — Search & discovery

### D1 — Search filters & sort

Filter pills above the results for which media types to include
(radio / tracks / artists / albums / playlists) and which providers, plus a
sort control (relevance / name / … — whatever `music/search` supports, else
sort client-side). The widget already asks for all media types; this is
mostly UI + passing `media_types` / `providers` through. Genre filtering:
check whether `music/search` takes a genre facet or whether it's a
`music/browse` path thing — note the answer here. Persist the last-used
filter set.

### D2 — Discovery / browse view

When the search box is empty, instead of just "up next", show browsable rows:
`music/recommendations` (once the library has content), `music/browse` into
`radiobrowser://popularity` and `ytmusic_free://` (charts / moods / genres).
This is the "home screen". Depends on M0 for layout; independent of the Q/P
entries.

---

## I — Interaction

### I1 — Clickable entities (artist / album / playlist)

Artist and album names in results, the queue, and now-playing become links.
Clicking an artist opens an artist view (top tracks, albums, "start artist
radio" via `play_media {radio_mode:true}`); clicking an album opens its track
list. Needs a lightweight in-widget navigation stack (a `view` state:
`browse | artist | album | playlist`, with a back affordance) — M0 should
decide how heavy this gets. `music/artists/*` and `music/albums/*` in
`/api-docs` for the data. This unblocks the "go to artist" row action in Q3.

### I2 — Row interaction model ("left-click actions")

Decide and implement one consistent model for what a left-click, a
right-click, and a hover do on a result/queue/playlist row, from M0's
comparison of how the reference players do it. Likely: left-click plays,
a `⋯` button (or left-click on a dedicated spot) opens a compact action menu
(play next, add to queue, add to playlist, go to artist/album, favourite,
remove). Right-click on a widget body already falls through to the OS menu
(`docs/widgets.md`) — don't fight that; use an in-content trigger. This entry
is the umbrella that Q3 / I1 / P1 all plug into — do it alongside M0's output,
not in isolation.

### I3 — Keyboard

Extend the existing `/` + space. From M0: likely ← / → seek (needs S1),
n / p next/prev, arrow-navigate the focused list, enter to play,
`a` add-to-queue. Scope from the comparison; keep it to what fits a widget
(no global media-key capture — that's an OS-integration rabbit hole, note it
as out of scope unless M0 strongly disagrees).

---

## X — Cross-cutting / infra these may need

### X1 — In-widget navigation

I1 (artist/album views), P1 (playlists view), D2 (discovery) and H1 (history)
all imply the widget grows from two panes (now-playing + browser) to a small
navigable app. Before building the second of those, add the shared piece: a
`view` state + a back button + a header that reflects where you are. Keep it a
plain reducer in `useMusic.ts` or a tiny `useView` — not a router lib. M0's
layout sketch drives this.

### X2 — `useQuery` for expensive reads

Artist pages, album track lists, playlist contents, discovery rows — cache
them with `@/wigl/hooks`' `useQuery` (`useSql: true` for the ones worth
persisting) rather than re-fetching on every navigation. Adopt as I1/P1/D2 get
built, not upfront.

### X3 — Grow the e2e test with each feature

`tests/music.e2e.test.ts` currently covers login / search shapes / audio-proxy
/ YouTube. Every entry that leans on a new MA command (seek, playlists,
history, move_item, …) adds one `test.skipIf(!reachable)` asserting that
command's real shape — the drift regression is the whole value (see AGENTS.md
"Testing"). Not a separate task; part of "done" for each entry.

---

## Out of scope (revisit only if M0 makes the case)

- **Visualiser** — the seam is kept (`DecodedAudioChunk`), but it's polish, not
  a core-player gap. After the list above.
- **Downloading / offline** — the widget is a streaming control surface;
  offline caching is a different product.
- **Local library** (Navidrome/Jellyfin via MA's Subsonic provider) — config,
  not widget code. Works today if the owner adds the provider.
- **Scrobbling to Last.fm / ListenBrainz** — MA-side provider config.
- **OS media-key / Now-Playing-widget integration** — needs Rust + entitlements
  (`docs/architecture.md`'s "one native poller" altitude). Big, separate.
- **Multi-room / multiple players** — MA supports it; the widget deliberately
  drives one player (its own). Not a gap.
