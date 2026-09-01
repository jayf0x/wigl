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

E3 shipped: `plbg:<id>` in `useStorage`, a system file chooser + downscale +
base64 through `sh -c` (`pickImage.ts`), rendered as a dimmed CSS background on
the playlist header. It works with no new dep and no core change. A *nicer*
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

## Effects tab — pending test · `[needs test]`

The Effects tab auto-switches output to `media-element` on open, which
reconnects the player. `useMusic` captures `nowRef.current.playing` into
`playIntentRef` before the switch and re-asserts it ~1.2 s after the new
player is `ready` (feedback G failsafe). Wanted: a `tests/music.e2e.test.ts`
case (guarded on `wigl-ma` being up, like the others) — play a track, flip
`audio_output` to `media-element`, assert the queue is still `playing`; then
pause, flip back to `direct`, assert still `paused`. Couldn't run it this
pass (server was down in the build env).

## Parked — playback speed (time-stretch) · `[researched]`

The rebuilt Effects tab ships a 4-band EQ + reverb but **no speed control**.
Evidence gathered this pass:
- **Server-side** `player_queues/set_playback_speed` → `"Invalid or
  unsupported command"` for the widget's player (it's an audiobook-only
  command).
- **`HTMLMediaElement.playbackRate`** is defined by the HTML spec to be
  ignored when the element's source is a `MediaStream` — and the Sendspin SDK
  sets `audio.srcObject` to a live `MediaStream`. So the cheap path is a
  dead end here, confirmed by spec not just by ear.
- **What's left:** a WSOLA / phase-vocoder **AudioWorklet** spliced into
  `audioGraph.ts`'s chain between the last EQ band and `master`.
  `@soundtouchjs/audio-worklet` (MIT, ~30 kB) is the candidate — load its
  worklet module as an inline `Blob` URL (no external file; CSP is disabled
  but a bundled data/blob URL is cleanest), add an `AudioWorkletNode` with a
  `rate` param, expose `setRate()` on the `AudioFx` handle.
  The clock (`getProgress` / A2) must multiply by that same rate — the
  `Scrubber` already reads `getProgress().playbackSpeed`, so wire the worklet
  rate into that field in `useMusic.getProgress()` and the rAF counter picks
  it up for free.
- **UI:** a speed `VFader` (already have the component) 0.5–1.5×, `detent={1}`,
  next to Reverb in `EffectsTab`.
Non-trivial (worklet lifecycle across the connection, resampling artefacts to
tune) but fully specced. Build when the owner wants speed.
