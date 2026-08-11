## Linux

- [x] Windowed-mode interactive flows verified — drag/drop, `useStorage` read/write, the per-widget error boundary, and the repos widget's Linux shell paths (`xdg-open`, VS Code CLI) all confirmed working, via headless X11 automation (XTest synthetic input + window screenshots, not a human on real hardware — this box is X11, not Wayland/GNOME). Specifics:
  - Dragging a widget by its grip persists the new `col`/`row` to `widget_layout` in sqlite and re-renders in the new spot with no residue at the old spot (see the ghosting item below for the one caveat).
  - `useStorage` round-trips correctly once its data isn't stale (see the key-prefix bug fixed below).
  - A widget made to throw during render shows an inline "widget crashed" message in its own grid cell; the rest of the desktop (other widgets, drag, etc.) keeps working.
  - repos widget's `xdg-open` and VS Code CLI (`/usr/bin/code`) both invoke correctly on Ubuntu; the GitHub Desktop fallback correctly no-ops when `github-desktop` isn't installed (no official Linux build, as the code's own comment expects).
  - Still open: this was X11, not real Wayland/GNOME — someone on actual Wayland hardware should still do a quick pass, since the windowed flow's WM/compositor behavior differs from X11's.
- [ ] Drag ghosting/residue — a measured cause was found and fixed on X11
  (`WEBKIT_DISABLE_DMABUF_RENDERER` is now set on Wayland sessions only;
  on X11 it was dropping the web process onto software compositing, ~83% vs
  ~28% CPU per drag on a fractionally-scaled 4K desktop). See
  `todo-ghosting.md` for the measurements, the disproven hypotheses, and the
  `scripts/dev/` harness. **Open**: owner confirmation that the visual
  symptom is actually gone — it has never been reproducible from synthetic
  input — and the same pass on real GNOME/Wayland hardware, where
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` still applies and the windowed flow's
  now-opaque window is still unverified.
- [ ] Heap corruption seen once: `malloc_consolidate(): unaligned fastbin
  chunk detected`, during scripted dragging *after* `631dd85` moved the
  cursor poller's GTK calls onto the main thread.

  **Do not chase this by hammering drags again.** It has now failed to
  recur across ~140 scripted drags under `gdb` in two sessions, which is
  enough to say randomized dragging is not a trigger — it only burns the
  owner's machine (see the input-budget note in `scripts/dev/README.md`).
  The one observation was on a build that still had
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` forced on X11, i.e. software
  compositing under heavy load; that path is gone as of `4d42394`, so this
  may already be fixed.

  Reopen only with a real backtrace from an organic occurrence:
  ```bash
  gdb -q -ex run --args src-tauri/target/debug/wigl
  # (gdb) bt / thread apply all bt  — once it aborts
  ```
  If it needs to be pursued deliberately instead, the next step is a
  sanitizer/valgrind build (neither is installed here), not more dragging.
- [x] Native HTML5 drag ghost: dragging on the desktop sometimes picked up
  the browser's own drag image — a translucent snapshot of widget content
  that follows the cursor, moves nothing, and drops nowhere. Widget dragging
  is a pointer-event gesture, so the native drag codepath is never wanted;
  `Desktop.tsx`'s root now calls `preventDefault()` on `dragstart`.
- [x] Text selection during drag: dragging across the desktop selected text
  out of whatever widgets the cursor passed over. `.wigl-widget` was opting
  the *whole* widget (header included) back into `user-select: text` on top
  of `.wigl-desktop`'s app-wide `none`. Now scoped in `App.css` to
  `[data-wigl-widget] > :not([data-widget-header])` — grid and chrome are
  unselectable, a widget's own content still selects and copies normally.
- [ ] **New, unconfirmed**: the whole grid was once observed shifted down by
  roughly half the screen height — still functional, just offset — after
  switching to Ubuntu's Activities overview during a long drag session.
  Suspected: the overlay window reacting to a transient monitor/work-area
  geometry change (the overview reports different dimensions), and the grid
  origin not being recomputed when it reverts. Worth checking whether
  `spawn_monitor_poller`'s `reconcile_monitors` or the frontend's monitor
  rect handling can latch a temporary size. Not yet reproduced deliberately.
- [ ] **New, unconfirmed**: the windowed-mode window was twice observed to have grown well past its `.inner_size(1100, 750)` startup size (e.g. to physical 2884×2438, later 3824×2210) with no `setSize`/`innerSize` call anywhere in the codebase (grepped `src/`, `src-tauri/src/` — nothing calls it). Repeated deliberate attempts to reproduce — fresh launches left idle, single/multi-step synthetic drags of varying size, tall `widget_layout` rows (up to row 23) — all stayed rock-solid at 2200×1500 (2x the logical 1100×750, i.e. correctly HiDPI-scaled). Only ever seen after a longer, organic sequence of interactions (several widget-settings clicks, a widget crash+recover, then a large cross-window drag) on one long-lived process; never on a fresh minimal repro. Could be a real GTK/WebKitGTK size-negotiation bug triggered by some interaction sequence, or could be an artifact of this session's synthetic-input testing method (XTest lacks some metadata real hardware input has, and a decorated+resizable X11 window means Mutter, not just the app, is a candidate cause). Trigger: if a real user on Linux ever sees the window balloon in size unprompted, check `xwininfo -id <id>` over time and see if it correlates with a specific action; otherwise not worth chasing further from synthetic input alone.
