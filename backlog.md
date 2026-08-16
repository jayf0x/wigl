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

- [ ] **B11 — Escape doesn't cancel a drag.** Deliberate gap: `screen-*` windows are `alwaysOnBottom` and rarely become key, so a `keydown` listener isn't reliably reachable today. Revisit only if/when one of these windows does become key for another reason (e.g. a command palette), since that would give a reliable focus target to hang the listener off.

## Features

- [ ] **F2 — LocalCode: branching instead of only revert-and-resend — blocked on opencode, not wigl.** Editing/resending a message today reverts the session to that point (opencode's `/session/{id}/revert`) and resends — no way to keep the original answer and explore an alternative alongside it. `POST /session/{id}/fork` looked like the fix, but verified live against a real `opencode serve 1.18.15` (a throwaway test session, and the real 21-session DB already on this machine): a forked session comes back with 0 messages — history isn't copied — and no `parentID` ever gets set, on a fresh fork or on any of the 21 real sessions checked. The OpenAPI schema declares `parentID` on `Session`, but the running server never populates it. Wiring `fork` today would create an empty, unlinked session with nothing to show as a sibling. Re-check against whatever opencode version is current next time this is picked up — may just be a version-specific gap.
- [ ] **F3 — LocalCode: sub-agent visibility beyond the inline badge — blocked on opencode, not wigl.** `PartRenderer.tsx` renders a spawned sub-agent as one inline one-line badge. `/session/{id}/children` looked like the fix, but it depends on the same `parentID` linkage F2 needs, which the running opencode server never sets (see F2) — verified live, `/children` returns `[]` even right after a fork. Worse for this case specifically: `SubtaskPart` (the part type a sub-agent spawn actually produces, per opencode's own OpenAPI schema) has no child-session-id field at all, only `prompt`/`description`/`agent`/`model` — a spawned sub-agent may not even be a separate top-level session `/children` could ever surface. Needs the actual server-side identifier a subtask's work item lives under, not just a working `children` call, before a sidebar nesting UI is possible.
- [ ] **F5 — Widget resize.** Today `w`/`h` are a first-launch hint only; no interactive way to resize a widget after it's placed. The drag grip was deliberately narrowed to the header's top-right corner (`WidgetHeader`, `data-drag-handle`) specifically so a resize handle has an uncontested spot to live — the natural pairing is a `data-resize-handle` grip at the bottom-right corner of `<Widget>`'s root, driving `reportGrid`'s `w`/`h` through the same `reflow`/`settle` machinery `Desktop.tsx` already uses for drag. Trigger: someone actually wants to resize a widget, not just reposition it.
- [ ] **F6 — Multiple instances of one widget type.** Today a widget is exactly one folder = one id = one instance, so e.g. two clocks on different timezones is impossible. `<Widget w h col row>` itself doesn't care about identity; the gap is discovery (folder name *is* the id) and storage (each instance needs its own key, not a shared one). A widget's `package.json` (`wigl` key) is the natural place for this to land — declaring itself instantiable, with the user's chosen instances and per-instance overrides stored like any other layout state. Trigger: a concrete want for two instances of one widget type.
- [ ] **F7 — (Very low priority) GNOME-native overlay flow via a Shell extension.** Wayland/GNOME sessions get the windowed flow instead of the real desktop-overlay one, because stock GNOME Wayland refuses a client absolute positioning and always-below/always-on-top stacking. A GNOME Shell extension ([desktop-widgets](https://github.com/NiffirgkcaJ/desktop-widgets)-style) could plausibly grant enough positioning/stacking control to run the real per-monitor overlay flow under GNOME too. Not worth pursuing casually — extra install step, version-fragile against GNOME Shell updates, needs real QA on positioning/stacking before switching GNOME users onto it by default. Trigger: someone actually bothered enough by the windowed flow's remaining UX gap (window doesn't stay pinned below/above other apps, doesn't span monitors) to try it.
- [ ] **F8 — Double-click-to-resize as an alternative entry point to F5.** Once F5's resize handle exists, add a second way in: double-clicking the resize grip switches the grid from drag mode to a dedicated resize mode for that widget (rather than requiring a click-drag on the grip itself), so resize and reposition read as two distinct gestures instead of one overloaded drag. Depends on F5 landing first — this is a UX refinement on top of it, not a standalone feature. Trigger: after F5 ships, if plain click-drag-to-resize on the grip turns out to feel error-prone or ambiguous with dragging.
- [ ] **F9 — Pinboard mode: free placement, no auto-stacking.** An alternate grid mode where dragged widgets can overlap freely and never get pushed/reflowed by `reflow`/`settle` (`src/wigl/grid/math.ts`) — pure user-controlled position, like a corkboard. Needs: (1) a per-monitor or per-widget toggle between today's collision-avoiding grid and this mode, (2) since overlap is now legal, a z-order story — simplest version is "the currently-selected/dragged widget gets a higher z-index than everything else, no full stacking history needed," only build the fuller N/N-1/N-2 rotating stack if the simple version proves insufficient in practice. Trigger: a concrete want for overlapping widgets, not just a nice-to-have — this is a bigger flow change than a patch, matches this file's "Features" bar.
