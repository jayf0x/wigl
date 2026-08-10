# Ghosting/tearing — root cause found and fixed, pending owner confirmation

Status: **one real, measured cause found and fixed**; needs the owner's own
eyes to confirm the symptom is gone, since it has never been reproducible
from synthetic input. Two leads previous sessions were chasing are now
positively **disproven** (not "untested" — disproven, with the commands to
recheck). Read the "Disproven" section before re-walking any of them.

## The fix

`lib.rs`'s `run()` used to set `WEBKIT_DISABLE_DMABUF_RENDERER=1` on **all**
of Linux. It now sets it on **Wayland sessions only** (new `wayland_session()`
helper, kept separate from `windowed_mode()` because `WIGL_MODE` can force
the windowed flow on an X11 session while a renderer workaround must key off
the real session type).

Why that variable was actively harmful on X11: WebKitGTK removed its X11
accelerated backing store, so the variable no longer means "use the other
accelerated path" — on X11 it means "fall off accelerated compositing
entirely" and composite in software in the web process. The blank-window
problem it works around is a Wayland problem; X11 never had it.

Measured on the repro machine (X11 GNOME, fractionally-scaled 4K =
6144x3456 framebuffer, WebKitGTK 2.52.3, Radeon RX 7900 GRE), identical
scripted drags via `scripts/dev/`:

| `WEBKIT_DISABLE_DMABUF_RENDERER` | `WebKitWebProcess` CPU during drag |
|---|---|
| `1` (old behaviour) | 82.4%, 82.6%, 82.6% |
| unset (new behaviour) | 26.5%, 31.4%, 28.1% |

Reproducible across runs, ~3x. That is the machine-specific factor the bug
report kept pointing at without anyone finding it: the cost scales with
framebuffer area, and this machine's framebuffer is 6144x3456 because GNOME
implements fractional scaling on X11 by rendering to an oversized
framebuffer and downscaling via a RandR transform (`gsettings get
org.gnome.mutter experimental-features` → `['x11-randr-fractional-scaling']`,
and `xrandr` shows a 6144x3456 framebuffer on a 3840x2160 mode). On an
ordinary 1080p/unscaled desktop the software path keeps up and nobody sees
anything; here it can't, and a drag presents half-updated frames.

**This is why it was Linux-only, this-machine-only, and why it survived
the switch from Wayland to X11** — the switch to X11 is exactly what made
the variable harmful rather than merely unnecessary.

## Still to confirm

The owner needs to drag widgets around and say whether the symptom is gone.
Nobody has ever reproduced it from synthetic input (see below), so there is
no automated check that can close this out.

If it is **not** gone, the next thing to try is `WEBKIT_DISABLE_COMPOSITING_MODE=1`,
which is still unrun against the symptom. Everything else cheap has been
tried.

## Disproven — do not re-walk these

- **"No compositing manager is running."** False. It was checked with
  `xprop -root _NET_WM_CM_S0`, which is the wrong tool: `_NET_WM_CM_S0` is
  an X *selection*, not a root window property, so `xprop -root` reports
  "not found" whether or not a compositor is running. Checking the actual
  selection owner (`XGetSelectionOwner`, a few lines of ctypes) shows mutter
  owning it. There is a compositor; there always was.
- **A missing/incorrect XDamage report from the app.** `scripts/dev/damage-watch.py`
  shows the overlay window reporting full-window damage on every frame of a
  drag, in both renderer configurations. The app tells X the truth about
  what changed; nothing is being under-damaged.
- **The compositor failing to repaint from a correct pixmap.** Forcing
  damage from outside the process (`XDamageAdd` over the whole window)
  changes nothing, and comparing the window's own backing pixmap against the
  composited root framebuffer shows them agreeing everywhere except regions
  covered by gnome-shell's own actors (see next point).
- **The "persistent mismatch strip at the left edge".** That is the Ubuntu
  dock. It's a gnome-shell actor, not an X window, so it never appears in
  `XQueryTree` and can't be masked out of a screen-vs-window comparison. It
  looks exactly like a stale vertical band and it is not one. Any future
  pixel-comparison work has to account for shell actors (dock,
  notifications, overview) before believing a mismatch.

## Reproduction tooling (new this session)

`scripts/dev/` now has a real X11 harness — see that folder's README.
`ghost-probe.py` / `widget-rects.py` / `ghost-verify.py` / `damage-watch.py`.
It drives actual XTest input against the real X server on real hardware and
reports numbers instead of screenshots.

**It still does not reproduce the visual symptom.** Across straight drags
and long multi-direction `wander_drag()` runs, `ghost-verify.py` reports 0.00%
mismatch when idle and no residue that survives more than the CSS
transition. That has now been true in three separate investigations, so
treat "synthetic input shows nothing" as a known property of this bug, not
as evidence the bug is gone. The harness is still worth keeping: it is what
produced the CPU measurement above, and it is what disproved three of the
four hypotheses in the previous handover.

## Unrelated live bug found while testing

The app still aborts with glibc heap corruption under sustained drag load:

```
malloc_consolidate(): unaligned fastbin chunk detected
```

Reproduced once during aggressive scripted dragging, on top of the
already-landed `631dd85` fix that moved the cursor poller's GTK calls onto
the main thread. So `631dd85` was necessary but is **not** sufficient —
there is at least one more thread-safety or lifetime bug. It did not
reproduce again in ~50 scripted drags under `gdb`, so no backtrace yet.
Tracked separately; it is not the ghosting cause (ghosting persists in a
process that never crashed), but it is real.

To catch it next time:

```bash
gdb -q -ex run --args src-tauri/target/debug/wigl
# reproduce, then at the (gdb) prompt: bt / thread apply all bt
```

## Kept from previous sessions (unchanged, still true)

- Windowed mode is opaque now (`eb41568`) — a reasonable change, still
  unverified either way because it only affects the Wayland/windowed path
  and nobody has run it on real Wayland hardware.
- The `React.memo` / imperative-drag refactor (`4e38ad5`) is a perf change
  with no functional bug in it. It is not implicated here.
- The repro machine: X11, GNOME Shell 46.2 / mutter, Ubuntu 24.04.4, kernel
  6.17, Mesa 26.0.0-devel, Radeon RX 7900 GRE, WebKitGTK 2.52.3.
