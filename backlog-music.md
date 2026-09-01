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

