## Linux

- [ ] Real Wayland/GNOME pass. Everything verified so far was done on X11
  (this box), including the windowed-flow interactive checks — drag/drop,
  `useStorage` round-trips, the per-widget error boundary, and the repos
  widget's `xdg-open`/VS Code CLI paths, all of which passed here. The
  windowed flow exists *for* Wayland though, and its WM/compositor behavior
  differs from X11's, so someone on actual Wayland hardware should redo the
  pass. Specifically still unverified there: `WEBKIT_DISABLE_DMABUF_RENDERER=1`
  (still applied on Wayland sessions) and the now-opaque windowed window.
- [ ] Drag ghosting/residue — a measured cause was found and fixed on X11
  (`WEBKIT_DISABLE_DMABUF_RENDERER` is now set on Wayland sessions only;
  on X11 it was dropping the web process onto software compositing, ~83% vs
  ~28% CPU per drag on a fractionally-scaled 4K desktop). See
  `todo-ghosting.md` for the measurements, the disproven hypotheses, and the
  `tests/manual/` harness. **Open**: owner confirmation that the visual
  symptom is actually gone — it has never been reproducible from synthetic
  input.
- [ ] Heap corruption seen once: `malloc_consolidate(): unaligned fastbin
  chunk detected`, during scripted dragging *after* `631dd85` moved the
  cursor poller's GTK calls onto the main thread.

  **Do not chase this by hammering drags again.** It has now failed to
  recur across ~140 scripted drags under `gdb` in two sessions, which is
  enough to say randomized dragging is not a trigger — it only burns the
  owner's machine (see the input-budget note in `tests/manual/README.md`).
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
- [ ] **New, unconfirmed**: the whole grid was once observed shifted down by
  roughly half the screen height — still functional, just offset — after
  switching to Ubuntu's Activities overview during a long drag session.
  Suspected: the overlay window reacting to a transient monitor/work-area
  geometry change (the overview reports different dimensions), and the grid
  origin not being recomputed when it reverts. Worth checking whether
  `spawn_monitor_poller`'s `reconcile_monitors` or the frontend's monitor
  rect handling can latch a temporary size. Not yet reproduced deliberately.
- [ ] **New, unconfirmed**: the windowed-mode window was twice observed to have grown well past its `.inner_size(1100, 750)` startup size (e.g. to physical 2884×2438, later 3824×2210) with no `setSize`/`innerSize` call anywhere in the codebase (grepped `src/`, `src-tauri/src/` — nothing calls it). Repeated deliberate attempts to reproduce — fresh launches left idle, single/multi-step synthetic drags of varying size, tall `widget_layout` rows (up to row 23) — all stayed rock-solid at 2200×1500 (2x the logical 1100×750, i.e. correctly HiDPI-scaled). Only ever seen after a longer, organic sequence of interactions (several widget-settings clicks, a widget crash+recover, then a large cross-window drag) on one long-lived process; never on a fresh minimal repro. Could be a real GTK/WebKitGTK size-negotiation bug triggered by some interaction sequence, or could be an artifact of this session's synthetic-input testing method (XTest lacks some metadata real hardware input has, and a decorated+resizable X11 window means Mutter, not just the app, is a candidate cause). Trigger: if a real user on Linux ever sees the window balloon in size unprompted, check `xwininfo -id <id>` over time and see if it correlates with a specific action; otherwise not worth chasing further from synthetic input alone.
