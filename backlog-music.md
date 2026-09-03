# music widget — backlog (post-iteration-3 feedback)

**Iteration-4 pass complete** — every item below (P0–P8) is done and committed
(see `git log`, the run of `music:` / `music + core:` / `core:` commits after
`d72510d`). What's left is **owner QA**, not code:

- **P0.3 (seek)** — needs a live scrub in the running widget to confirm the
  bar no longer snaps back through a rebuffer.
- **P0.4 (effects)** — needs a by-ear check (`tests/audio-check.md`): reverb
  obvious by ~60–70%, a big EQ cut audible.
- **P2 (playback speed)** — the container `sitecustomize.py` patch needs
  Docker up + the container recreated with the new mount (`SETUP.md`
  "Playback speed"), then `docker exec wigl-ma python -c …` to confirm the
  shim registered. Docker was down for this whole session so this couldn't
  be exercised live.
- The **live e2e suite** (`tests/music.e2e.test.ts`) skipped all session
  (Docker down); run `bun run wigl test widgets` once `wigl-ma` is back.

Read `wigl-widgets/music/state.md` first for the current runtime shape, files
and MA cheatsheet. `SETUP.md` = backend, `FEATURES.md` = user-facing,
`COMPARISON.md` = the M0 reference-player study.

## How the items were worked

Per item: reproduced the bug / confirmed the shape against MA source or
`/api-docs`, fixed the smallest thing, verified (`typecheck` + `typecheck:widgets`
+ `widget:verify wigl-widgets/music` + `wigl test widgets`; `bun run verify` for
`src/` changes), grew `tests/music.e2e.test.ts` for new MA commands, committed
via `git-meow`, updated `state.md`. **Design rules** (from `state.md`): music
player and nothing more; responsive at any tile size; monochrome, theme tokens
only; views replace the pane; never leak dev-context text into UI strings.

---

## P0 — Broken core behaviour  ·  done

- **P0.1/P0.2** `afdedc8` — a plain `play()` always starts the track now and
  never touches the view.
- **P0.3** `0d7edef` — post-seek playhead is projected forward until the SDK
  clock converges (needs a live scrub to fully confirm).
- **P0.4** `6cbed6d` — effects tap the Sendspin MediaStream
  (`createMediaStreamSource`), resume the AudioContext (needs a by-ear check).
- **P0.5** `0bceeda` — queue drag reorders without dropping pointer capture.
- **P0.6** `96cc6e4` — the auto-start-server toggle no longer reconnects.
- **P0.7** `265fa54` — the macOS background-image picker `mktemp -d` fix
  (later superseded by P7's Pillow path).

---

## P1 — Optimistic UI everywhere

*Done (commit `bdcc8e9`). `optimisticRef` holds each predicted field until
`player_queues/get` agrees; `resyncRef` re-asserts drift after any reconnect;
`docs/architecture.md` has the pattern. `.mx-flash` on the confirming
reconcile was left out — the hold-until-confirmed behaviour already removes
the visible lag; revisit only if the owner wants the extra ack.*

---

## P2 — Speed control (server-side `atempo`)

*Done (commit see git log). `SETUP-files/sitecustomize.py` wraps
`set_playback_speed` to lift the audiobook gate; `useMusic` has
`playbackSpeed`/`setPlaybackSpeed` (optimistic, reverts on refusal,
re-asserted on reconnect); `NowPlaying` has the `Gauge` fold-out slider + a
tap-to-reset badge on the scrubber, hidden for radio. e2e covers the command
shape. **The container patch + by-ear verification is pending Docker being
back up** — `docker exec wigl-ma python -c "…"` per SETUP.md "Playback speed".*

---

## P5 — Tooltips

*Done. P5.1/P5.2 — `<Tooltip>` wraps the whole button in `Row`; `NowPlaying`'s
`IconBtn` shows its label by default (`tip={false}` opts out). P5.3 (commit
`580a105`) — `src/components/ui/tooltip.tsx` is now the ~30-line pure-CSS
version from the owner's research block; Base UI dropped, `side`/`align`
edge-pin, research comment gone.*

## P6 — Queue & playlist ordering + editing

*P6.1 done (commit `3f9d3ae`) — "Queue" everywhere.*

*P6.2 done. MA has **no** playlist track-reorder command (the builtin
provider is append + remove-by-position only), so a reorder is a full
rewrite: `reorderPlaylist` does `remove_playlist_tracks(all)` +
`add_playlist_tracks(newOrder)`. The uri list comes from the widget's loaded
tracks, so nothing is server-only if the re-add fails. The drag itself is the
shared `useDragReorder` hook (also now backs the Queue tab). Capped at
`PLAYLIST_RENDER_CAP`.*

*P6.3 done — `src/components/ui/inline-edit.tsx` (`<InlineEdit value onSave
className inputClassName />`, owned code, registered as a host module). The
playlist title in `PlaylistView`'s header is now an `InlineEdit` (click →
input + check button); the "Rename" pill is gone. Available to any widget for
an editable label.*

*P6.4 done — the background-image affordance moved off a pill and onto the
cover thumbnail: hover (or focus) the cover → add/change + remove buttons
overlay it, spinner while the file picker is open. Still the base64 path (P7).*

---

## P7 — `[wigl core]` A wigl image upload / retrieval system

*Core version done. `src/wigl/utils/pickImage.ts` → `pickAndProcessImage()`
(system file chooser + Python/Pillow resize + JPEG re-encode + base64, one
`sh -c`), and `src/wigl/hooks/useUploader.ts` → `useUploader({ key, maxEdge })`
→ `{ url, busy, pick, clear }` binding a storage key to the result. Both
exported from the barrels; `docs/widgets.md` + `global-deps.md` (Pillow)
updated; a `bun:test` guards the Python hop. The music widget's fragile
`pickImage.ts` (`sips`/ImageMagick) is deleted — `DetailView` calls
`pickAndProcessImage` directly (it keeps its own many-covers map rather than
one `useUploader` per playlist).*

**Still deferred** (owner's call — needs the "how big do images get" answer):
the Tauri asset-protocol + `convertFileSrc` path for large images, and an
`useImage(key)` read-only hook. Base64-in-kv covers the current need.

---

## P8 — Small

*P8.1 done (live search waits for 3+ chars in `Browser.tsx`; empty clears,
explicit submit / history chips unaffected). P8.2 rejected — no measured
art-fetch cost; recorded in `state.md` "Locked decisions".*

---

## Deferred (unchanged from before — real, just not now)

- **Rich track metadata** — `music/tracks/get` `metadata.*` is null without an
  MA metadata provider (MusicBrainz etc.) on the server. Backend-only: add one
  in `SETUP.md`'s onboarding. The widget already renders whatever appears.
- **Queue-as-playlist (literal D4)** — render the queue as a pinned Playlists
  entry, add/remove/reorder through the exact playlist components. Large UI
  restructure; the append-default + two-step-clear + Save already cover the
  "fragile queue" concern. Revisit if it still feels fragile after P0.5/P1.
- **Full left-rail navigation** — the pinned strip shipped instead; a rail that
  replaces the tab bar eats width a narrow tile can't spare. Revisit past ~5
  top-level destinations, as a container-width-collapsing rail.
- **Local files** — MA's `filesystem_local` provider needs a second Docker
  mount (`-v "$HOME/Music":/media:ro`) in `SETUP.md`, then add it in the MA web
  UI (the Browse tab's "＋ add a music source" footer opens it).
- **List virtualization** — no measured perf problem; `PLAYLIST_RENDER_CAP`
  (250) guards it; a virtualizer fights the drag-reorder. `@tanstack/react-virtual`
  bundled as a widget dep is the path when a real large playlist visibly lags.
