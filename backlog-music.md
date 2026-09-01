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

## Queue-as-playlist — the fuller D4 reframe · `[deferred]`

D1/D2/D3 shipped (append-by-default toggle, save-queue-as-playlist,
two-step clear, toggle-aware playlist/album/artist play, `+N more` cap on
playlist track rows). The **literal** D4 reframe — rendering the queue as a
pinned entry in the Playlists tab, add/remove/reorder through the exact same
components as a real playlist — was NOT done: it's a large UI restructure for
unclear payoff in a compact tile, and the owner's core concern ("one misclick
and it's gone") is already covered by append-default + two-step clear + Save.
Revisit only if the current Up-next tab still feels fragile in use.

D5 (virtualize long lists) is also deferred — no measured perf problem, and a
virtualizer fights the pointer drag-reorder. The `PLAYLIST_RENDER_CAP` (250)
guard is in place. Pick this up only when a real large playlist visibly lags;
`@tanstack/react-virtual` bundled into the widget is the path (it's not a host
module, so it'd be a widget dep, which is allowed).

---

## Playlist background image — a proper picker is deferred · `[deferred]`

E3 shipped, then extended (feedback E): backgrounds moved from a per-playlist
`plbg:<id>` key to one `playlist_images` map (`{ [item_id]: dataURI }`) owned
by `useMusic`, and `playlistImage.ts`'s `playlistDisplayImage()` now resolves
one image (custom > MA art > first track > icon) for the detail header, the
Playlists-list rows *and* the pinned strip. A system file chooser + downscale +
base64 through `sh -c` (`pickImage.ts`) still supplies the data URI, no new dep
and no core change. A *nicer*
picker — drag-drop, a preview thumbnail, per-playlist row thumbnails, images
that survive being large — would want `tauri-plugin-dialog` + the Tauri asset
protocol + a `convertFileSrc` host module (~15 LOC core). Only worth it if the
base64-in-kv approach proves too limiting in practice.

---

## Navigation — full sidebar vs. the shipped pinned strip · `[deferred]`

F1 shipped the **smaller version**: a horizontal `PinnedStrip` of pinned
playlists above the Home tabs (pin/unpin from a playlist row's `⋯` or the
playlist-view header, `useStorage` `pinned_playlists`). A full left rail that
*replaces* the tab bar was evaluated and rejected for now: the widget is often
narrow, a permanent vertical rail eats width a small tile can't spare, and it's
a large layout rewrite for a mostly-cosmetic gain. If the tab bar genuinely
becomes the bottleneck (more than ~5 top-level destinations), revisit as a rail
that collapses to an icon strip / a bottom bar under a container-width
threshold — same `.music-cq` container-query mechanism the row inline actions
already use.

## Local files — MA `filesystem_local` provider · `[needs backend]`

F2 research: MA ships a `filesystem_local` music-provider domain
(`providers/manifests` confirms it). The blocker is the Docker mount — `wigl-ma`
only bind-mounts `.idea/ma-data → /data`, so `filesystem_local` can only see
paths *inside* the container. Concrete next steps:
1. `SETUP.md`: add `-v "$HOME/Music":/media:ro` (or a documented configurable
   path) to the `docker run`.
2. Then `filesystem_local` can be added in the MA web UI pointed at `/media`
   (the "＋ add a music source" footer in the Browse tab already opens that UI).
3. Optional later: drive `config/providers/setup {provider_domain:
   "filesystem_local"}` from the widget — it's a multi-step config-entry flow,
   non-trivial in a compact tile, so the web-UI handoff is the pragmatic path.
`builtin/add_track {url:"file:///data/…"}` also still works for one-off files
already inside `/data`.

---

## Blocked — playback speed (time-stretch) · `[blocked — needs owner decision]`

The owner has asked for a speed slider twice. After a real build attempt this
pass it's **not shippable without changing the audio transport**, which is a
locked decision (`state.md`: "Sendspin stays the audio transport"). Evidence:

- **Server-side** `player_queues/set_playback_speed` → `"Invalid or
  unsupported command"` for a normal player (audiobook-only).
- **`HTMLMediaElement.playbackRate`** is spec-ignored when the element's
  source is a `MediaStream`, and the Sendspin SDK sets `audio.srcObject` to a
  live `MediaStream`. Same for a naive `AudioBufferSourceNode` rate node — we
  don't own a buffer source, only a `MediaElementSource`.
- **`@soundtouchjs/audio-worklet` (v2.1.1)** — cloned and read this pass. Its
  `SoundTouchNode` exposes `pitch` / `pitchSemitones` / `playbackRate` params
  but **no `tempo` param**: v2 does time-stretch by feeding samples *faster*
  via the source's `playbackRate` and using the node only to compensate
  pitch. With a fixed-rate realtime `MediaStream` input the node can pitch-
  shift but cannot change tempo.
- **The root problem is physics, not the library:** a live stream delivers
  samples at exactly realtime. You cannot speed up (the later samples don't
  exist yet) and slowing down means an unbounded, ever-growing output buffer.
  Only pure pitch-shift (not "speed") is achievable in-widget.

**Paths that would actually work, each needs an owner call:**
1. Give the widget a seekable local buffer it controls (drop Sendspin's
   `MediaStream` path, or add a Tauri audio plugin) — contradicts a locked
   decision; biggest change.
2. Accept pitch-shift-only ("chipmunk / slow-mo", not tempo) via the
   SoundTouch node — cheap, but it's not what "speed" means and would
   probably annoy more than help.
3. Ship nothing and take speed off the table for this architecture.

`state.md` "Locked decisions" now records this. `@soundtouchjs/audio-worklet`
was **not** added as a dependency.
