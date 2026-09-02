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

### P0.4 — The Effects chain produces no audible change

Owner enabled/disabled and moved every slider — no reverb, no EQ, nothing
(or far too subtle). `audioGraph.ts` looks structurally right (source → 4
peaking filters → dry + convolver-reverb → master → `ctx.destination`), so
suspects, in order:
1. **The graph's `AudioContext` starts suspended and is never resumed.** It's a
   *separate* context from the SDK's; only `unlock()` calls `fxRef.current?.resume()`,
   and only if `fxRef` exists at that moment. Opening the Effects tab + dragging
   a slider without hitting play again leaves it suspended → the `<audio>`
   element (now routed through `createMediaElementSource` into the suspended
   graph) outputs **silence**. Resume the graph context on tab open and on
   every play, and surface its `.state` somewhere while debugging.
2. **`createMediaElementSource` didn't attach** (throws if called twice on one
   element; or the element isn't the SDK's actual sink). Log it.
3. **Reverb too subtle** — `reverbWet.gain` maxes at 1.0 with a 2.6 s synth IR;
   at 100% it should be obvious. If (1)/(2) are ruled out, make a stronger IR
   and a wider wet range.
Needs webview devtools. Once fixed, add a note to `FEATURES.md` and verify by
ear at reverb 100% + a big EQ cut.

### P0.5 — Queue drag-reorder is broken

Owner: can only drag a row *over the first item*; index 0 ↔ index 2 swaps, then
index 2 goes greyed-out, and dragging again swaps it back. So the pointer-drag
math (`move_item` `pos_shift`, the optimistic local reorder, the reconcile on
`queue_items_updated`) is wrong. Also: **it commits live** — the owner wants the
reorder to be **local-only during the gesture and pushed to MA once, on drop**
(or even: never auto-save, all reorders local until a Save button — accepting
that the *currently playing* track's real position may differ from the local
view). Files: `QueueList.tsx` (the drag handling), `useMusic.ts`
`moveQueueItem`/`moveQueueItemToEnd`. **Also:** pointer-drag inside a wigl
widget may have its own gotchas (the widget lives in a shared realm, `data-no-drag`
vs the desktop's own drag) — worth a `tests/manual/` repro script and/or a pure
unit test of the reorder reducer (the array-move logic, separated from the DOM).
See `docs/debugging.md` "cross-monitor drag" for how flaky pointer stuff is here.

### P0.6 — Disabling "Auto-start server" stops the music

The connect `useEffect` deps include `manageServer`, so toggling it tears down
and rebuilds both sockets. The iteration-2 "resume if was playing" failsafe
(`playIntentRef`, re-asserted ~1.2 s after `ready`) either isn't firing for
this path or the timing's wrong. **The owner wants this generalised into a
real safety net:** after *any* state change that could have disturbed
playback (a reconnect, a settings toggle, even a playlist write one day),
compare intended vs actual play state and re-assert. One mechanism in
`useMusic.ts`, always on. See P1.

### P0.7 — Playlist background image doesn't display

Set a background on a playlist → nothing shows (detail header, list thumb,
pinned chip). The `plbg:<id>` → `playlist_images` map migration (iteration 2)
may have broken the read path, or the base64 upload via `pickImage.ts` +
`sh -c` is failing/producing an unusable data URI. This is superseded by **P7**
(a proper wigl image system) — but if P7 is a separate session, at least make
the current base64 path actually round-trip: pick → store → `<img src>` shows,
in all three places, verified live.

---

## P1 — Optimistic UI everywhere · partly `[wigl core]`

The owner wants this to be **the widget's defining quality**: *the UI always
reflects the optimistic state; the server catches up.* Local playback through
Docker has real latency (play/pause takes ~3 s to confirm) and every control
should hide that.

### P1.1 — Audit and fix the optimistic layer

`useMusic.ts` already has `markPending` / `api.pending` and optimistic
`setNow` for play/pause/next/seek — but the owner still waits ~3 s for the
pause button to toggle, so it's not working end to end. Go through every
control:
- **Predict** the new state locally and render it immediately.
- **Disable** the triggering control until the confirming event lands (or a
  timeout).
- **Reconcile** from the server event; on timeout, re-read and correct.
- Covers: play/pause, next/prev, seek, repeat, shuffle, volume, queue add/
  remove/reorder, favourite, playlist create/add/remove, the queue-mode toggle.
Apply the `.mx-pending` shimmer while a control is unconfirmed and `.mx-flash`
on the confirming reconcile.

### P1.2 — A state-resync safety net

One always-on mechanism in `useMusic.ts`: snapshot `{playing, elapsed, repeat,
shuffle, volume, queueId}` before any teardown / major action, and after the
next `ready` (or a short debounce after any command) diff it against the fresh
server snapshot and re-assert anything that drifted. The owner's framing: *"if
one day creating a playlist would also stop the music, it at least restarts."*

### P1.3 — `docs/` guidance on optimistic UI · `[wigl core]`

Write a short section (extend `docs/architecture.md` "Data flow pattern", or a
new `docs/optimistic-ui.md` if it earns its own file — check `AGENTS.md`'s doc
table first) on the predict → disable → reconcile → correct pattern for wigl
widgets talking to a laggy backend, with the music widget as the worked
example. Keep it to the pattern + one example, per the repo's "docs are
intent-only" rule.

---

## P2 — Speed control (server-side `atempo`)

**Full spec: `wigl-widgets/music/todo-speed.md`** (owner-written). Summary: MA
already time-stretches via ffmpeg `atempo`, gated to audiobooks by one line;
unlock it with a `sitecustomize.py` `PYTHONPATH` mount on the `wigl-ma`
container (no image rebuild), then a small widget control
(`player_queues/set_playback_speed {queue_id, speed}`, model on
`repeatMode`/`cycleRepeat`). The SDK's `trackProgress` already compensates for
`playback_speed`, so the scrubber needs no clock change. Verification checklist,
doc updates, and a client-side slow-down-only fallback are all in that file.
Delete `todo-speed.md` and the (now removed) "blocked" note once shipped.
`/frontend-design` for the control's look — a speed badge on the scrubber row,
visible only at ≠ 1×.

---

## P3 — Effects tab polish

### P3.1 — Fader alignment

The 4 EQ faders + reverb are `justify-between` across the full pane width →
oceans of dead space on a wide tile. Group them (fixed fader width, centred
cluster, a small gap; the reverb fader set off by the existing divider), so it
reads as one piece of gear, not sliders flung to the edges.

### P3.2 — Sliders select text while dragging

Dragging a `VFader` (and check the volume `Slider`, the seek bar) selects
surrounding text. Add `user-select: none` + `touch-action: none` on the fader
track/handle, `e.preventDefault()` on `pointerdown`, and consider a
`.mx-nodrag-select` utility in `music.css` if it recurs.

---

## P4 — "Server not running" needs a real UI

When `wigl-ma` / Docker is down the widget just shows the small
`ErrorOverlay`. The owner wants the **LocalCode widget's pattern** — a clear
in-widget state with a **"Start server" button** (and, ideally, "Start Docker"
if the daemon itself is down — `serverProcess.ts` already has `findDocker` +
`restartMaContainer`; add a `docker desktop`/`open -a Docker` path). The
**"Auto-start server" setting should be visible here too** (a checkbox in the
overlay, not buried in Settings) — the owner suspects the disconnect between
that setting and the UI is part of the confusion. Read
`wigl-widgets/LocalCode/index.tsx` + its `ErrorOverlay` usage for the shape.

---

## P5 — Tooltips

### P5.1 — Trigger on the whole button, not just the icon

`RowActionPanel` / inline action buttons wrap the `<Tooltip>` around the icon,
so the hint only shows on a pixel-perfect icon hover. Wrap the *button*.

### P5.2 — Every primary action has a tooltip

Play, pause, next, prev, add-to-queue, add-to-playlist, favourite, go-to-artist,
radio, the queue-mode toggle, the effects on/off — all get `<Tooltip content>`.

### P5.3 — Simplify `src/components/ui/tooltip.tsx` · `[wigl core]`

The owner left a research block **inside the file** (`/* TODO RESEARCH … */`)
proposing a ~30-line pure-CSS Tailwind tooltip (`group-hover/tt`, no Portal, no
Base UI, `left-0`/`right-0` edge-pin instead of centred/collision-flipped) with
honest caveats (an `overflow-hidden` ancestor still clips; `aria-label` on the
trigger instead of `aria-describedby`). Read it, implement it, run the full
build + every consumer (music widget uses it in `Row.tsx` + `NowPlaying.tsx`;
grep for other `@/components/ui/tooltip` importers), then **delete the research
comment**. This is a good standalone research→cleanup subagent task.

---

## P6 — Queue & playlist ordering + editing

### P6.1 — Rename "Up next" → "Queue"

Everywhere: the Home tab label, `state.md`, `FEATURES.md`, comments.

### P6.2 — Playlist drag-reorder

Same interaction as the queue (P0.5) — reorder tracks in `PlaylistView` by
drag, committed on drop. MA: check `music/playlists/*` for a track-reorder
command (there may not be one — might need remove + re-add at position, or
`add_playlist_tracks` with an index). Verify against `/api-docs`.

### P6.3 — Rename playlist by double-clicking the name · needs `[wigl core]` `InlineEdit`

Drop the "Rename" pill. Double-click the playlist title in `PlaylistView`'s
header → it becomes an input with a save affordance (button at its
centre-right). The owner: *"sounds like a Wigl component too — content that is
editable with a save button and a passable callback."* Build
`src/components/ui/inline-edit.tsx` (`<InlineEdit value onSave />`, owned code,
`className` passthrough), register it, use it for the playlist name. Also a
candidate for the queue-saved-as-playlist name and anywhere else a label is
user-editable.

### P6.4 — Edit the background image *on the cover*

Move the background-image affordance off a pill and onto the cover thumbnail in
`PlaylistView`'s header: hover the image → edit / remove controls overlay it.
Ties into P7.

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

### P8.1 — Search: 3-character minimum

Don't fire `music/search` under 3 chars (currently 1). Trim the debounce path
in `Browser.tsx`. Keep the search-history chips working.

### P8.2 — Settings: "Disable previews / artwork"

An optional toggle to skip fetching album art / previews entirely (render the
icon fallbacks). Owner is unsure it's a real problem — measure whether art
fetches ever actually matter (they're `<img loading=lazy fetchpriority=low>` on
their own already) before building; if not, drop this.

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
