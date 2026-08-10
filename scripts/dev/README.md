# scripts/dev

Reusable, rerunnable scripts (bash/python/AppleScript/whatever fits) for
manually exercising a specific flow — not automated tests, not CI. The point
is a lightweight, predictable way to QA something ("does drag still work
across monitors", "does the composer still stream a reply") without writing
and maintaining a full test suite for it.

- One script per flow, named for what it checks (`check-drag.sh`, not `test1.sh`).
- A script that only makes sense for one widget lives in that widget's own
  folder instead (see root `AGENTS.md`'s script-placement rule) — this
  folder is for repo-wide flows.
- Delete a script once the flow it checks no longer exists or is covered by
  a real automated test instead. This folder isn't an archive.

## X11 overlay-rendering harness

Four Python scripts (stdlib + ctypes against libX11/libXtst/libXdamage, plus
PIL) for diagnosing overlay-mode rendering on a real X11 session, without
taking screenshots to read by eye. They drive real input through XTest and
report numbers. All require an X11 session and a running app (`bun run qa`).

- `ghost-probe.py` — the shared primitives: find the wigl windows, capture a
  drawable, synthesize motion/clicks, and `wander_drag()` (a long,
  direction-changing drag; a short straight synthetic line has repeatedly
  failed to reproduce drag bugs a real hand-driven drag shows).
- `widget-rects.py` — current widget rects and each one's drag-grip point,
  read out of the overlay window's alpha channel. Feed these to the others;
  don't hardcode coordinates, the layout moves.
- `ghost-verify.py` — the actual correctness check: wherever the overlay
  window's own pixel is fully opaque, the composited root framebuffer must
  show that RGB. Masks windows stacked above the overlay (it's
  always-on-bottom, so everything else legitimately covers it) and requires
  the window pixmap to be static across the capture, so animation doesn't
  read as a fault. Note it cannot mask gnome-shell's *own* actors (the Ubuntu
  dock, notifications) — those aren't X windows, and they show up as a
  persistent mismatch strip at the screen edge. That is not a bug in wigl.
- `damage-watch.py` — the XDamage rects the overlay reports during a drag,
  i.e. what the compositor is being told to re-upload.
