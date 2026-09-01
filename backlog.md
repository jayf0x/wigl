# Backlog

Atomic tasks, not a priority-ordered roadmap. Each entry is a problem or gap
someone (or an agent) could pick up and finish in one sitting without asking
"what does this mean?" first. Product ideas live in `docs/future-ideas.md`;
this file is defects, gaps, and known ceilings in what already exists.
Code-organization/quality heuristics (file size, naming, future-proofing)
live in `docs/principles.md`, not here — that's a standing rule to apply
continuously, not an atomic task to finish once.

Two sections, by size of change, not urgency — there's no priority order
within or across them. Items are numbered per section (`B1`, `F1`, ...) so
they can be referenced elsewhere; numbers aren't stable across edits — if
you need to point at one from another doc, quote its title, not just the
number.

- **Bugs** — existing functionality doesn't do what it's supposed to, or a
  targeted, self-contained fix/tweak to something that already works.
- **Features** — a capability that doesn't exist today, big enough that
  building it changes the current flow rather than just patching it.

Rules for keeping this file real:

- Every entry must be actionable right now. If it's not, it doesn't belong here.
- One clear next step per entry, not a menu of options — if a decision only the
  owner can make is genuinely blocking, say so in one line and name the default
  to fall back on, don't leave it open-ended.
- When an item is fixed, delete it. Don't check it off and leave it, don't move it to a "done" or "changelog" list — git history is the changelog.
- When a decision is made and closed with no remaining follow-up work, delete it too. Don't keep a "Decided / won't fix" graveyard.
- No dates, no "as of this session", no "swept on", no references to when something was added or by whom. This file describes the current state of the codebase, not its history.
- If a fix is genuinely speculative (no concrete trigger yet), say so plainly and give the trigger condition — don't leave vague "might be nice" entries.
- Prefer deleting or rewriting a stale entry over leaving it half-true when the code has moved past it. New entries follow this same file's own rules — keep it that way.

## Bugs

- [ ] **Bx — `biome check` (`bun run format:check` / `lint`) is repo-wide red.** ~33 formatting errors across already-committed files (`src/components/ui/dialog.tsx`, `scroll-area.tsx`, `textarea.tsx`, `src/wigl/settings/*`, several `tests/*.test.ts`, …) — the committed source doesn't match the repo's own `biome.json`. Not caught by `bun run verify` (it runs typecheck/build/widget checks, not biome), so it drifted. One clear next step: `bun run format` (`biome check --write ./src ./tests`) once, review the diff, commit it — then `format:check` is a meaningful gate again. If some rule is genuinely unwanted, relax it in `biome.json` in the same pass rather than leaving the whole check failing.

- [ ] **B11 — Escape doesn't cancel a drag.** Deliberate gap: `screen-*` windows are `alwaysOnBottom` and rarely become key, so a `keydown` listener isn't reliably reachable today. Revisit only if/when one of these windows does become key for another reason (e.g. a command palette), since that would give a reliable focus target to hang the listener off.
- [ ] **B14 — LocalCode: typed multiple spaces sometimes render as a line break.** Owner QA report: typing several consecutive spaces in the composer (Crepe/Milkdown) can show up as a `<br>`/line break once sent, rather than the literal spaces typed — "not what the user typed." Investigated without a live repro: `markdown.ts` (the assistant-message renderer) never emits a `<br>` and has no space-collapsing logic, so this isn't in wigl's own rendering path — the cause is somewhere in Milkdown/Crepe's own DOM-text-to-markdown serialization (`@milkdown/preset-commonmark`'s `hardbreak` node only binds to `Shift-Enter`, not plain space-typing, per its schema in `node_modules/@milkdown/preset-commonmark/src/node/hardbreak.ts` — ruled out as the direct trigger) or in how ProseMirror/the browser normalizes repeated space characters in a contentEditable text node before Crepe ever serializes it. A `bun --preload ./tests/register-dom.ts` script driving `CrepeBuilder` directly (inserting text via a raw transaction) didn't reproduce it — the `markdownUpdated` listener never fired, so that harness isn't set up close enough to real typing to trust either way. Next step: reproduce live in the running app (type "a    b" in the composer, send, check what the message actually contains) with dev tools open to inspect the DOM text node before/after Crepe processes it — needs a human at the keyboard or a real input-simulation harness (`tests/manual/`), not another `bun -e` reproduction attempt.

## Features

- [ ] **F11 — music widget: audio playback is "kinda" — nail down the flakiness.** Owner confirms sound reaches the speakers, with reservations. The likely culprits and their knobs are documented in `wigl-widgets/music/tests/audio-check.md`: the `SENDSPIN_OUTPUT` toggle (`"direct"` vs `"media-element"` in `music.config.ts`), `codecs:["pcm"]`, and the unsigned-dev-build `WebKit Media Playback` RBS-assertion (which can let WebKit throttle the media process when the window isn't focused — plausible for an always-on-bottom widget). One next step: reproduce the specific bad behaviour (stalls? cuts out on blur? never starts?), then pick the fix from that doc. Feature-level player work is tracked in `backlog-music.md`, not here.
- [ ] **F12 — music widget: the free YouTube provider is a moving target.** `wigl-ma` runs `ghcr.io/sproft/ytmusic-free-provider` (stock MA + the community `ytmusic_free` provider, anonymous `yt-dlp`). Search + playback work today (verified live), but this rides YouTube's internal APIs and Google breaks them every few weeks — the fix is `docker pull` a fresh image (`SETUP.md` → "Update MA + provider"). If breakage becomes frequent enough to be annoying, options are: pin to a known-good `:latest-<runid>` tag, or reconsider a widget-side stack (`youtubei.js` + `bgutils-js` + a yt-dlp sidecar — bigger, splits playback off MA's Sendspin path, needs a new core host-module for HTTP). No action unless it actually starts breaking a lot.
- [ ] **F13 — music widget: Sendspin "non-compliant client" warning on connect.** MA logs `non-compliant client: initial client/state has an active player role but no player state` every time the widget's `SendspinPlayer` connects. The player registers and plays fine regardless — `@sendspin/sendspin-js@5.0.0` sends `client/state` before it has a player state to report, and MA 2.10.1's `aiosendspin` server warns but tolerates it. Harmless log noise. Trigger to fix: a newer sendspin-js/MA pairing that turns the warning into a rejection, or the log volume actually bothering someone. Likely just a version-skew quirk that resolves itself on the next bump of either side.

- [ ] **F2 — LocalCode: branching instead of only revert-and-resend — blocked on opencode, not wigl.** Editing/resending a message today reverts the session to that point (opencode's `/session/{id}/revert`) and resends — no way to keep the original answer and explore an alternative alongside it. `POST /session/{id}/fork` looked like the fix, but verified live against a real `opencode serve 1.18.15` (a throwaway test session, and the real 21-session DB already on this machine): a forked session comes back with 0 messages — history isn't copied — and no `parentID` ever gets set, on a fresh fork or on any of the 21 real sessions checked. The OpenAPI schema declares `parentID` on `Session`, but the running server never populates it. Wiring `fork` today would create an empty, unlinked session with nothing to show as a sibling. Re-check against whatever opencode version is current next time this is picked up — may just be a version-specific gap.
- [ ] **F3 — LocalCode: sub-agent visibility beyond the inline badge — blocked on opencode, not wigl.** `PartRenderer.tsx` renders a spawned sub-agent as one inline one-line badge. `/session/{id}/children` looked like the fix, but it depends on the same `parentID` linkage F2 needs, which the running opencode server never sets (see F2) — verified live, `/children` returns `[]` even right after a fork. Worse for this case specifically: `SubtaskPart` (the part type a sub-agent spawn actually produces, per opencode's own OpenAPI schema) has no child-session-id field at all, only `prompt`/`description`/`agent`/`model` — a spawned sub-agent may not even be a separate top-level session `/children` could ever surface. Needs the actual server-side identifier a subtask's work item lives under, not just a working `children` call, before a sidebar nesting UI is possible.
- [ ] **F7 — (Very low priority) GNOME-native overlay flow via a Shell extension.** Wayland/GNOME sessions get the windowed flow instead of the real desktop-overlay one, because stock GNOME Wayland refuses a client absolute positioning and always-below/always-on-top stacking. A GNOME Shell extension ([desktop-widgets](https://github.com/NiffirgkcaJ/desktop-widgets)-style) could plausibly grant enough positioning/stacking control to run the real per-monitor overlay flow under GNOME too. Not worth pursuing casually — extra install step, version-fragile against GNOME Shell updates, needs real QA on positioning/stacking before switching GNOME users onto it by default. Trigger: someone actually bothered enough by the windowed flow's remaining UX gap (window doesn't stay pinned below/above other apps, doesn't span monitors) to try it.
- [ ] **F8 — Double-click-to-resize as an alternative entry point to edge-resize.** Edge resize handles now exist (`RESIZE_EDGES`/`data-resize-handle` in `Desktop.tsx`), so this is unblocked: add a second way in, double-clicking a resize grip switches the grid from drag mode to a dedicated resize mode for that widget (rather than requiring a click-drag on the grip itself), so resize and reposition read as two distinct gestures instead of one overloaded drag. Trigger: plain click-drag-to-resize on the grip turning out to feel error-prone or ambiguous with dragging.
- [ ] **F10 — File System Access API for pure-data widgets.** Chrome/Edge
  desktop expose a per-tab, user-granted local file read/write API with no
  analog in wigl today — a todo/notes-shaped web widget could persist to a
  real file on disk instead of IndexedDB. Desktop Chrome/Edge only (no
  Safari, no mobile), and it's read/write on user-picked files, not
  shell-exec — doesn't unblock any widget that needs real command
  execution. Trigger: a wigl-web project actually gets attempted (see
  `docs/future-ideas.md`'s "Rejected idea's" — none exists today).
- [ ] **F9 — Pinboard mode: free placement, no auto-stacking.** An alternate grid mode where dragged widgets can overlap freely and never get pushed/reflowed by `reflow`/`settle` (`src/wigl/grid/math.ts`) — pure user-controlled position, like a corkboard. Needs: (1) a per-monitor or per-widget toggle between today's collision-avoiding grid and this mode, (2) since overlap is now legal, a z-order story — simplest version is "the currently-selected/dragged widget gets a higher z-index than everything else, no full stacking history needed," only build the fuller N/N-1/N-2 rotating stack if the simple version proves insufficient in practice. Trigger: a concrete want for overlapping widgets, not just a nice-to-have — this is a bigger flow change than a patch, matches this file's "Features" bar.
