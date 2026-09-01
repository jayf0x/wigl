# music widget vs. real players — capability comparison (M0)

Purpose: stop hand-writing a feature spec. Five real players were cloned into
`.idea/refplayers/` (gitignored) and read for interaction patterns; this table
is what came out, and `todo-musicplayer.md` was rewritten from it.

## Reference players read

| Repo | Stack | Why it's here | What transferred |
|------|-------|---------------|------------------|
| `music-assistant/frontend` | Vue | The direct reference — what MA surfaces of its own API | Now-playing bottom bar, `InfoHeader` (info panel), `LyricsViewer`, discover shelves, `MediaItemThumb`/`MiniEqualizer`, browse-tree navigation |
| `jeffvli/feishin` | React/Electron | Best-in-class queue + context-menu UX in FOSS | The full row-action model (see below), queue drawer, move-to-top/bottom, "Go to" submenu, seek slider + waveform |
| `nukeop/nuclear` | React/Electron | Closest in spirit: no-account multi-source streaming | `TrackContextMenu` = {Play now, Play next, Add to queue, Favourite, Add to playlist}; queue panel with pointer drag-reorder |
| `qier222/YesPlayMusic` | Vue | The "beautiful minimal" now-playing + lyrics reference | Clicking art/artist/album navigates; big centred lyrics; restraint in control count |
| `dweymouth/supersonic` | Go/Fyne | Wildcard — keyboard-driven minimal desktop client | Waveform seekbar, album-browse filters, "artist radio" = artist + similar, sort-by-column, repeat one/all + shuffle modes, 15-band EQ, media-key/MPRIS (explicitly out of scope for us) |

## Capability table

`have` = works today · `partial` = half-built · `missing` = real gap · `cut` = deliberately not doing it in a grid tile

| Capability | Status | Why / smallest version that fits a tile |
|---|---|---|
| Play / pause / next / prev | have | `player_queues/{play,pause,next,previous}`. Done. |
| **In-track seek (scrubber)** | **missing** | **RESOLVED: `player_queues/seek {queue_id, position}` works** against the live Sendspin player, both directions, even with `flow_mode:true` (tested — see `todo-musicplayer.md` S1). Smallest: make the existing progress bar a click/drag target; ~1s rebuffer gap on jump is acceptable. |
| Repeat / shuffle | **missing** | Not in the widget at all today. `player_queues/repeat {queue_id, repeat_mode}` (off/one/all), `player_queues/shuffle {queue_id, shuffle_enabled}`. `PlayerQueue` already returns `repeat_mode` + `shuffle_enabled`. Smallest: two toggle icons next to the transport row. |
| Volume | have | Sendspin-local (`player.setVolume`), collapsible slider. Fine — it's this widget's own player. |
| Now-playing art + title + artist | have | Serif title, art with radio/disc fallback. |
| Now-playing "more info" panel | missing | `QueueItem.streamdetails` (live) has codec/sample-rate/bit-rate/loudness; `Track.metadata` has genre/description/links; `Album.year`. Smallest: an info icon that folds down a compact key/value list, collapsed by default, `useStorage`-persisted. |
| Lyrics | **cut** | Owner cut it outright ("I dont need lyrics. Only music player"). Also: `metadata/get_track_lyrics {track}` 500s on non-library tracks. Not building it. |
| Queue: view up-next | have | `player_queues/items`, sliced after current. |
| Queue: non-destructive play | partial | Left-click currently does `option:"replace"` — wipes the queue. `QueueOption` enum is `play/replace/next/replace_next/add`. Switch default to `replace_next` (play now, keep tail), keep the existing "Clear" as the only queue-emptier. |
| Queue: remove one item | missing | `player_queues/delete_item {queue_id, item_id_or_index}`. Per-row action. |
| Queue: drag-to-reorder | missing | `player_queues/move_item {queue_id, queue_item_id, pos_shift}` + `move_item_end`. Pointer-drag (repo already has the pattern in `Desktop.tsx`), optimistic, reconcile on `queue_items_updated`. Small list — no dnd library. |
| Queue: move to top / bottom | missing (feishin has it) | Falls out of the row-action menu once `move_item`/`move_item_end` are wired — cheap add alongside drag-reorder. |
| Playlists: list + view | missing | `music/playlists/library_items` → `library://playlist/N`; `music/playlists/playlist_tracks {item_id, provider_instance_id_or_domain:"library"}`. |
| Playlists: create / rename / delete | missing | `create_playlist {name}` (→ editable `library` playlist, verified), `update {item_id, update}`, `music/library/remove_item {media_type:"playlist", library_item_id}` (verified; `music/playlists/remove` 500'd). |
| Playlists: add / remove tracks | missing | `add_playlist_tracks {db_playlist_id, uris[]}` (async BackgroundTask, verified), `remove_playlist_tracks {db_playlist_id, positions_to_remove[]}`. Wired from a search row, a queue row, and now-playing. |
| Playlists: play / queue a playlist | missing | `play_media` with the playlist uri. |
| Favourites | missing | `music/favorites/add_item {item:<uri>}`, `music/favorites/remove_item {media_type, library_item_id}`. Heart toggle on now-playing + rows. `Track.favorite` is on the object already. |
| Play history ("watch history") | missing | **Server-side: `music/recently_played_items {limit, media_types}`** returns real `ItemMapping`s (verified — no local log needed). Smallest: a "Recent" view listing them, each one-click re-playable. |
| Search history | missing | Local only. `useStorage`, cap ~20, chips under the field when focused + empty. Tiny, independent. |
| Search: live / debounced | have | 260ms debounce, provider-agnostic. |
| Search: type + provider filters | partial | Already asks for all types; needs pills to narrow `media_types` / `providers` and persist the set. `music/search` takes both. No sort param — sort client-side if wanted. |
| Discovery / browse "home" | missing | `music/recommendations` is **empty on a fresh install** (all 16 folders return 0 items — they're library-derived). Real discovery here = `music/browse` provider tree (root → `radiobrowser://` / `ytmusic_free://…` → Artists/Albums/Tracks/Playlists folders, verified) + `recently_played_items`. Smallest: when search is empty, show a browsable folder list instead of just up-next. |
| Clickable artist / album | missing | `music/artists/get`, `music/artists/top_tracks`, `music/artists/artist_albums`, `music/albums/album_tracks`, `music/artists/similar_artists`. Needs a lightweight in-widget view stack. |
| Artist radio | partial | `startRadio()` exists (`play_media {radio_mode:true}`). `radio_mode` is now deprecated in MA → "translated to a `radio_playlist://` dynamic playlist"; still works, note for later. |
| In-widget navigation (view stack) | missing | Prerequisite for artist/album/playlist/history/discovery. A `view` reducer + back button + a header that says where you are. No router. |
| `useQuery` caching for expensive reads | missing | Artist pages / album tracks / playlist contents / browse rows. Adopt per-consumer, `useSql:true` for the persist-worth ones. |
| Row interaction model | partial | Today: left-click = play, hover reveals radio + add-to-queue icons. Target (from feishin/nuclear): left-click = play now; one `⋯` button opens a compact menu {Play next, Add to queue, Add to playlist, Go to artist/album, Favourite, Start radio, Remove (queue only)}. One control, not five icons. Right-click stays OS menu (widget rule). |
| Keyboard | partial | `/` + space today. Add: ←/→ seek, n/p, ↑/↓ list nav, enter play, `a` add-to-queue. No global media keys (needs Rust + entitlements — out of scope). |
| Visualiser | cut | Seam kept (`DecodedAudioChunk`). Polish, not a player gap. After everything else. |
| EQ / DSP | cut | `Equalizer.tsx` is a decorative bar animation, not audio DSP. MA has `config/players/dsp/*` but a 15-band EQ in a tile is not the product. |
| Gapless / crossfade | cut | `player_queues/crossfade` exists server-side; it's an MA config toggle, not widget UI. |
| Scrobbling | cut | MA-side provider config (Last.fm/ListenBrainz). Not widget code. |
| Downloading / offline | cut | Streaming control surface; offline is a different product. |
| Multi-room / multiple players | cut | MA supports it; the widget deliberately drives its own one player. |
| Media-key / OS now-playing integration | cut | Needs Rust + macOS entitlements (`docs/architecture.md` "one native poller" altitude). Big, separate. |
| Sleep timer | cut (noted) | `players/sleep_timer/set` exists. Cute, low priority — not on the roadmap unless asked. |

## What materially changed vs. the owner's starting list

1. **Repeat / shuffle is a genuine missing basic** — not on the owner's list, not
   in the old backlog. Cheap. Recommend adding it near the top.
2. **History needs no local log** — `music/recently_played_items` is server-side
   and returns real items. The old H1 plan (local `useStorage` ring buffer +
   `media_item_played` event) is unnecessary; just read the server.
3. **Discovery is not "recommendations"** — that endpoint is empty until the
   library has content. D2 becomes a `music/browse` folder navigator.
4. **Lyrics is cut** — owner's call ("only music player"), and the endpoint is
   fragile anyway.
5. **The row-action menu (I2) is the spine** — Q3, I1, P1, favourites and
   history all hang off one `⋯` menu component. Build it before the second
   consumer, not per-feature.
6. **Navigation stack (X1) is load-bearing** — artist/album/playlist/history/
   discovery all need it. It's the first real infra piece.
7. **Accent colour**: recommend staying monochrome. It's distinctive and the
   ink-on-paper look is working. The one place an accent could earn its keep is
   the now-playing progress fill once it's a live scrubber — optional, minor.
8. **Tile size / layout**: owner's call — bump the first-launch default up
   *and* make every view responsive from small to large ("make it work
   anywhere"), don't design to a fixed size. Nav stack replaces panes rather
   than stacking. See `todo-musicplayer.md` → "Design rules for every entry".
