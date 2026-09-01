# music widget — feature backlog

The core player works (radio + free YouTube Music through Music Assistant,
search, queue, now-playing, playlists, artist/album views, favourites,
history, browse, keyboard). This is the list for the next round of refinement.

**Read `wigl-widgets/music/state.md` first** — it's the live technical context
(runtime shape, files, data flow, MA command cheatsheet, known rough edges).
`wigl-widgets/music/COMPARISON.md` is the reference-player comparison.
`wigl-widgets/music/SETUP.md` is the backend.

## How to work this list

- **Groups are the unit of work**, not entries. Each group is a coherent
  cluster meant to be taken by one agent (or one session) so related code
  lands together. Entries within a group share files and should be committed
  together or in tight sequence.
- **Status tags**: `[researched]` — investigated this session against the live
  server / current code, findings are in the entry, ready to build.
  `[needs research]` — investigate before building; not yet dependent on any
  session context. `[design]` — a real product/UX decision to make first,
  probably worth a round-trip with the owner.
- **Never implement blindly.** Every entry says what to verify. Verify it.
- **After each group**: commit (via `~/.claude/skills/git-meow/scripts/commit.sh`),
  run the full check (`bun run typecheck` + `typecheck:widgets` +
  `widget:verify` + `wigl test widgets`; `bun run verify` for feature-sized
  changes), grow `tests/music.e2e.test.ts` for any new MA command, delete the
  finished entries here, and **update `state.md`**.
- **Design rules** (from `state.md`, non-negotiable): music player and nothing
  more; responsive at any tile size (actually resize-test); monochrome, theme
  tokens only; views replace the pane, never a third vertical zone.
- Research passes can run async/in parallel. Code must be serialized —
  several groups touch `useMusic.ts` and `Row.tsx`.

---

## Rich track metadata needs an MA metadata provider · `[needs backend]`

C3 shipped the expanded `TrackInfo` (clickable artists/credits, description,
label, genre, year, popularity) but on the stock `wigl-ma` server every rich
`music/tracks/get` `metadata.*` field comes back **null** — `performers`,
`label`, `review`/`description`, `mood`, `style`, `release_date`, `popularity`.
`allow_update_metadata:true` doesn't help. These are populated by MA's
**metadata providers** (MusicBrainz, TheAudioDB, fanart.tv), none configured on
this image. Next step: add one (MusicBrainz is free, no key) in `SETUP.md`'s
`docker run` / onboarding, or a Settings "enrich metadata" helper (H group).
The widget code already renders whatever shows up, so this is backend-only.

---

## Group D — Queue as a first-class playlist · `[design]` (big)

Owner's framing: "a queue is something fragile. One misclick and it's gone.
So I would turn a queue into a temp playlist." This reshapes how enqueue,
row-click, start-radio, and playlists all interact. Design round-trip with
the owner recommended before building. Touches `useMusic.ts` heavily +
`Home.tsx` + `QueueList.tsx` + `Row.tsx`.

### D1 — Overwrite-vs-append toggle · `[researched]`

A persistent UI toggle (owner's idea: a small icon next to repeat/shuffle)
with two states — **Replace** / **Append** — that governs what a plain
left-click on a track does, and what "load playlist into queue" and "start
radio" do. `player_queues/play_media`'s `option` maps: Replace → `"replace"`,
Append → `"add"`; the current non-destructive `"play"` (insert-after-current +
skip) could be a third "Play now" that's always available as an explicit
action regardless of the toggle. Persist via `useStorage`. This is the
smallest, most independently-shippable piece of group D — consider doing it
first, even standalone.

### D2 — Save queue as playlist

An action (button in the Up-next tab header) that copies the current queue
into a new editable playlist named `queue - <timestamp>` (editable name),
via `create_playlist` + `add_playlist_tracks` with the queue items' uris.
Does **not** clear the queue. Needs `player_queues/items` → uris → the two
playlist calls. Straightforward once D-group direction is set.

### D3 — Load playlist into queue

From a playlist view / row: "Play" (respects the D1 toggle) and an explicit
"Add to queue". `play_media` with the playlist uri and the mapped `option`.
Verify a playlist uri is accepted by `play_media` (it should be — it's a
`Playlist` media type).

### D4 — Queue-as-playlist model (the full version)

Model the queue in the UI as an always-present, un-deletable playlist:
add/remove/reorder use the same components and mental model as a real
playlist, just different label/icon. "Clear" becomes a deliberate two-step.
This is mostly a UI/naming reframe over the existing `player_queues/*`
commands — MA's queue *is* already persistent server-side. Decide with the
owner how far to take it (is it literally rendered in the Playlists tab as a
pinned entry? or just the Up-next tab restyled?).

### D5 — Virtualize long queue / playlist lists · `[needs research]`

Owner: "Should we virtualize the queue and playlist items? Draggable might
make this difficult." Research: current lists are capped (`limit:50` queue
items, playlists likely similar) so this may be premature. If a playlist can
have thousands of tracks and the UI renders all of them, virtualize —
`@tanstack/react-virtual` is the small option, but check it survives the
host-module boundary and the pointer drag-reorder. Measure first: how big do
real playlists get, does render lag at 500 rows. If not a problem, cut this.

---

## Group E — Playlists: the gaps · `[researched + design]`

### E1 — Playlist rename · `[needs research]`

`music/playlists/update {item_id, update:{name}}` updates the library row but
a builtin-provider playlist keeps its own name and the row re-syncs from the
provider — verified the rename doesn't stick. The MA frontend renames
playlists somehow; find how (watch its network tab against the running
server, or read `.idea/refplayers/frontend` — search for `rename` /
`playlist` / `update`). If there's genuinely no working path for
builtin-provider playlists, document that and make rename a delete+recreate
under the hood (preserving tracks). Until then P6 stands.

### E2 — Playlist delete + rename UI

Delete exists (`music/library/remove_item`) — make sure it's reachable and
confirmed (two-tap). Add an inline rename field to the playlist view header
(gated on E1 actually working).

### E3 — Playlist custom background image (local file) · `[needs research]`

Owner wants a local image as a playlist background. Research: a widget can't
read arbitrary local files — needs the Tauri **asset protocol** scope + a
`convertFileSrc` host module (~15 LOC core, noted in the old fallback
section), OR read the file as base64 through `sh -c` and use a data URI, OR
copy the picked file into MA's data volume and serve it via MA. Also: where
does the picked-path come from — a native file dialog needs
`tauri-plugin-dialog` (not currently a dep). Scope this properly before
committing to an approach. The image itself is then a CSS `background-image`
on the playlist view / a thumbnail on the playlist row, path persisted per
playlist in `useStorage`.

### E4 — Playlist merge — CUT or make it explicit · `[researched]`

`add_playlist_tracks` **silently ignores a playlist uri** passed as a track
(verified — accepted, added 0). So there's no free merge. Options: (a) cut
"add to playlist" *for playlist rows* entirely — the `⋯` on a playlist only
offers play/queue/rename/delete; (b) implement a real "Merge into…" action
that reads the source playlist's tracks and `add_playlist_tracks` each uri.
Owner likes the merge idea but flagged it as advanced. Recommend (a) for now
+ a backlog note for (b). Either way: **the current UI offers "add to
playlist" on playlist rows and it does nothing** — fix that (it's misleading).
Add an e2e assertion for whichever path is kept.

---

## Group F — Navigation & sources · `[design]` + `[needs research]`

### F1 — Sidebar (YouTube vibe) · `[design]`

Owner: "a lot of options… we might need a sidebar to abstract some. Some more
of a YouTube vibe could be nice, where you have a sidebar with playlist
icons." Currently: 4 Home tabs + search + a nav stack. A left rail (icons:
Now/Queue, Search, Playlists, Recent, Browse, + pinned playlist thumbnails)
would replace the tab bar and free vertical space. This is a layout
redesign — sketch it against the tile-at-any-size rule (a rail costs
horizontal space a narrow tile can't spare — maybe it collapses to icons, or
becomes a bottom bar under a width threshold). Decide with the owner. Big.

### F2 — Local file / folder browser · `[needs research]`

Add local tracks. Research paths: (a) MA's **filesystem provider** — add it
pointed at a folder, MA scans + serves it, the widget just searches/browses
it like any provider (cleanest, no widget code beyond a "add local folder"
setup helper); (b) `builtin/add_track {url:"file:///data/…"}` — works but the
file must be inside MA's Docker volume (verified earlier this project); (c) a
widget-side file picker (`tauri-plugin-dialog`) + copy into the volume. (a)
is almost certainly the answer. Verify MA's filesystem provider setup flow and
whether it can point at an arbitrary host path given the container mount.

---

## Group G — Audio engine · `[needs research]` (not session-dependent)

### G1 — Audio effects tab: reverb / speed / EQ

Owner wants a separate tab with reverb, playback speed, and EQ (explicitly
*no* repeat there). Reference implementation to crib from:
`/Users/me/Documents/GitHub/audio-bonanza` (`audio-bonanza-extension/content.js`
— a Web Audio chain: `createMediaElementSource` → low-shelf / peaking filters
/ `ConvolverNode` reverb / `DelayNode` → destination, with A/B presets).
**Research needed:**
- The chain needs a Web Audio node to tap. In `SENDSPIN_OUTPUT:"direct"` the
  SDK owns its AudioContext and connects straight to destination — no tap. In
  `"media-element"` mode it routes through a hidden `<audio>` — the widget can
  `createMediaElementSource(that element)` → effect chain → destination.
  **So G1 probably forces `media-element` mode.** Confirm the SDK exposes /
  allows this without fighting its own gain node.
- **Playback speed** fights Sendspin's clock sync (`correctionMode`) — the
  protocol streams at 1× and re-syncs. Changing `<audio>.playbackRate`
  downstream may work (with `preservesPitch`) or may cause underruns.
  Test before promising it. If speed is infeasible with Sendspin, say so.
- Effect state must **not** desync the A2 heuristic time display (a slowed
  track's clock must slow too).
- Look for cleaner options than the audio-bonanza extension code (it's a
  content-script hack) — a small reusable Web Audio graph module.
- Presets persisted via `useStorage`.

### G2 — Higher-quality audio path

Owner: "Investigate if there's use for a different type of audio playing. We
could use a Tauri plugin, maybe that yields higher quality? Currently sounds
good but double-check." Research: `codecs:["pcm"]` over localhost is already
lossless from MA's perspective (MA transcodes the source to PCM). The ceiling
is the *source* (YouTube opus ~130-160 kbps; radio varies). A native Tauri
audio plugin (e.g. `rodio`-backed) could play MA's `:8097` HTTP flow stream
directly instead of Sendspin — bypassing the WKWebView audio path entirely,
possibly lower-latency and definitely simpler, at the cost of losing the
in-realm `<audio>`/Web Audio tap (kills G1) and needing a Rust plugin +
capability. Weigh it. Likely verdict: not worth it unless there's an audible
problem, but document the tradeoff.

### G3 — Fetch priority: audio first, everything else last

Owner: "all things that are not the sound itself — even the metadata — should
be fetched as lowest priority compared to the audio." Investigate whether
this is actually a problem: audio rides its own dedicated `/sendspin`
WebSocket, unaffected by `fetch`/`/ws` traffic. Album-art `<img>` loads and
`music/*` calls compete only with each other. The one real lever: add
`fetchpriority="low"` + `loading="lazy"` to art `<img>`s, and debounce/queue
metadata reads so a burst of them can't stall a `play_media`. Probably a
15-minute change once confirmed it matters; don't over-build.

---

## Group H — Ops & docs · `[mixed]`

### H1 — Widget Settings: manage the backend without a CLI · `[design]`

Owner wants wigl to control Docker / clear caches so no terminal is needed.
Candidates for the Settings section (or a small "Backend" panel in the
widget): "Restart MA" (`docker restart wigl-ma`), "Update MA image"
(`docker pull … && docker rm -f … && docker run …` — needs the full run
command as a constant), "Clear MA cache" (what cache? `docker exec wigl-ma`
to clear a dir, or wipe part of `.idea/ma-data`), "Wipe & re-onboard".
Needs the `command` permission (already held) + `shell:allow-spawn` if any
are long-running (probably not). Design which actions are safe to expose and
what confirmation each needs. `SETUP.md` becomes the fallback, not the
primary path.

### H2 — SETUP.md accuracy pass · `[do now — see below]`

Partly done in this commit (removed the dead `todo-musicplayer.md`
reference, clarified the community image IS the setup not a migration).
Re-read it end to end against the running container before closing this.

### H3 — User-facing feature docs · `[do soon]`

Not technical docs — a short "what this widget does" for the non-obvious
custom features (the `⋯` actions, start-radio's behaviour, playlists,
overwrite/append, filters, keyboard). Lives in `wigl-widgets/music/` as
`FEATURES.md` or similar. Write it once groups A-E settle so it's not
immediately stale.

---

## Group I — "Start radio" semantics · `[researched]`

Verified: `play_media {radio_mode:true}` **replaces the entire queue** with
[the seed track + ~25 similar tracks] (e.g. seed "Pink Floyd – Time" →
Black Sabbath, Aerosmith, Fleetwood Mac…). The seed does stay as the current
item. `radio_source` comes back `[]` (it's the deprecated static-ish path,
not an ongoing dynamic radio). Owner's read ("removes the queue, plays a
different track") is *mostly* accurate — it's destructive.

- **I1** — Make it respect the D1 overwrite/append toggle (append radio to the
  current queue instead of always replacing).
- **I2** — Rename it in the UI so the behaviour is obvious ("Start a mix from
  this" / "Radio from…") and only offer it where it makes sense (tracks,
  artists — not radio stations).
- **I3** — Consider the non-deprecated path: `play_media` with a
  `radio_playlist://` uri for a genuinely dynamic, self-extending queue.
  Research what that uri looks like (`/api-docs`, the MA frontend).

---

## P6 — Playlist rename (carried over)

Folded into E1. Delete this line once E1 resolves it.
