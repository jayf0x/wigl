# music widget — backlog (post-iteration-3 feedback)

The widget is feature-complete on paper — search, queue, playlists, radio,
artist/album views, favourites, history, browse, keyboard, an effects tab, a
motion layer, backend controls. **But iteration-3 QA surfaced real breakage in
core paths** (playing a search result, seeking, the effects chain, queue drag,
playback surviving a settings toggle) plus a clear direction: *the whole widget
should feel optimistic — the UI leads, the server catches up.*

This file is the plan for the next working session. Read
`wigl-widgets/music/state.md` first (runtime shape, files, MA cheatsheet,
known-issues). `SETUP.md` = backend, `FEATURES.md` = user-facing, `COMPARISON.md`
= the M0 reference-player study, `wigl-widgets/music/todo-speed.md` = the
owner's full spec for the speed feature.

## How to work this list

- **P0 first** — those are broken core behaviours, and several are regressions
  from the polish passes. Nothing else matters until a search result plays on
  click and playback survives a settings change.
- Then P1 (optimistic UI — the owner wants this to be *the* theme), then the
  rest roughly in order. Items tagged **`[wigl core]`** touch `src/` and the
  host-module registry — they're bigger than the widget and could be their own
  sessions.
- Per item: reproduce the bug / confirm the shape against the running server
  (`http://127.0.0.1:8095/api-docs/commands.json` is truth), fix the smallest
  thing, verify (`bun run typecheck` + `typecheck:widgets` + `widget:verify
  wigl-widgets/music` + `wigl test widgets`; `bun run verify` + `bun run build`
  for `src/` changes), grow `tests/music.e2e.test.ts` for any new MA command,
  **commit** (`~/.claude/skills/git-meow/scripts/commit.sh`), update `state.md`,
  delete the finished entry here.
- **Design rules** (non-negotiable, from `state.md`): music player and nothing
  more; responsive at any tile size — actually resize-test; monochrome, theme
  tokens only; views replace the pane, never a third vertical zone; **never put
  dev-context text ("see the backlog", "TODO", "A1") into user-visible strings**
  — a shipped string that references the backlog is a bug (this happened in the
  Effects tab; fixed, don't repeat it).

---

## P0 — Broken core behaviour

*All clear — P0.1–P0.7 fixed (git log `music:` commits). P0.3/P0.4 need the
owner's by-ear + live-scrub QA to fully confirm; the structural causes are
addressed.*

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

The owner's vision (sketches, not a spec):
- `useImage("music:playlist-cover:<id>")` — a hook that returns a displayable
  URL for a stored image by key.
- `const onUpload = useUploadImage({ compress: true, target: "PNG" })` — upload
  a picked file into local storage, converted/compressed to a web-friendly
  format by default.
- `useUploader({ path })` — the full wrapper: file-pick + upload + retrieve.
- A **small Python helper** for the image conversion/compression (reliable
  format, small size, React-friendly) — shelled out to, like the rest of wigl's
  "real CLI over Rust" approach. (`Pillow` is the obvious choice; add to
  `global-deps.md`.)
Storage: the wigl kv table (base64) is fine for a handful of small covers; a
large-image story would want the Tauri asset protocol + `convertFileSrc` (~15
LOC core) — decide based on expected sizes. The music widget's playlist covers
(P0.7 / P6.4) are the first consumer; design the API against that use, keep it
general. **This is its own session** — big, core, and the widget can limp along
on the current base64 path until it lands.

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
