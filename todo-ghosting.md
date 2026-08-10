# Ghosting/tearing handover — unresolved

Full handover for whoever picks this up next. Status: **not fixed**. Two
related-but-separate fixes landed this session (real bugs, worth keeping)
but neither resolved the actual symptom on the owner's real hardware. Read
this whole file before touching code — several plausible-looking leads
already turned out to be dead ends or off-target, documented below so
they're not re-walked from scratch.

## Symptom, in the owner's own words

Original report: "window flickering / screen tearing... the background is
never cleared and widgets redraw when moving around."

Refined after more QA (this is the important, still-unexplained clue):

- Drag a widget, then **wait ~10s and move the cursor** → clears.
- Drag a widget, then **keep clicking on it** → never clears.

That's a real, specific, reproducible-by-them state machine, not generic
"sometimes flickers." Something about cursor motion after an idle period
forces a repaint that a click doesn't. Nobody has yet figured out what that
something is. This is probably the single most valuable lead in this file —
see "Most promising unexplored lead" below.

Confirmed by the owner:
- Happens on **Linux only**, not macOS.
- Happens in **both** overlay mode (X11, their actual repro machine) and
  was originally suspected in windowed mode too (unconfirmed on real
  Wayland hardware — see TODO.md, nobody has actually reproduced it there,
  only reasoned about it).

## Environment of this session's repro machine

This box (where all the investigation below happened):

```
XDG_SESSION_TYPE=x11
XDG_CURRENT_DESKTOP=ubuntu:GNOME
GPU: AMD Radeon RX 7900 GRE (navi31, Mesa/radeonsi, DRM 3.64)
direct rendering: Yes
```

**No compositing manager registered** — checked via:

```bash
DISPLAY=:0 xprop -root _NET_WM_CM_S0
# => _NET_WM_CM_S0:  not found.
```

`mutter-x11-frames` process is running, the X server's `Composite`
extension is present (`xdpyinfo | grep -i composite`), and
`gsettings get org.gnome.mutter experimental-features` shows no compositor
explicitly disabled (`['x11-randr-fractional-scaling']` only) — so this
isn't an obvious intentional-disable. But the EWMH compositor-selection
atom genuinely isn't set. **This was found late in the session and never
actually tested as a cause** — see next-steps. Worth taking seriously:
transparent/alpha-blended windows under X11 fundamentally depend on a
compositing manager for correct damage-tracking/double-buffering; without
one, stale-pixel artifacts on a transparent window are a known class of
problem independent of any app-level bug. This could plausibly explain
overlay mode (real transparency) and be irrelevant to windowed mode (now
opaque, see below) — which would also explain why nobody's confirmed the
symptom on Wayland/GNOME (different compositor, always-on, can't be
"missing" the way an X11 one can).

**Not yet checked**: whether this is specific to this one dev machine's X11
session config, or true of the owner's own machine too. If the owner is
also running X11 with no compositor, this one experiment is probably worth
running before anything else:

```bash
DISPLAY=:0 xprop -root _NET_WM_CM_S0
```

If it also comes back "not found" on their machine, try forcing a
compositor on (if GNOME/Mutter has one available but inactive, or install
`picom` for a quick A/B — even temporarily, just to test the hypothesis) and
see if the ghosting disappears. That's the single highest-value experiment
nobody has run yet.

## Changes made this session, in order, with honest before/after

### 1. `WidgetItem` + `React.memo` extraction — commit `4e38ad5`

**Not a ghosting fix.** This was a separate ask (drag felt laggy /
re-render perf). Stops Desktop's per-drag-tick `setLayout` from
re-rendering every widget's React subtree. Mentioned here only because it
changed the *timing/frequency* of DOM writes during a drag, which is
relevant context for anything downstream that's timing-sensitive (see
`5.` below).

### 2. Imperative ref-based drag (no React state per pointer move) — same commit

Also perf-only, not a ghosting fix at the time. Changed `onPointerMove` to
write `el.style.transform` directly via a ref map instead of going through
`setLayout` → React commit → `useLayoutEffect`. Same net transform values,
same CSS transition, different call path and timing (no React scheduler in
the loop now, straight synchronous DOM writes per pointer event).

**Retrospective note**: this is a real behavior change to *when and how
often* the browser's/WebKit's paint pipeline gets touched during a drag. It
was reasoned through carefully at the time for correctness (verified
`layoutRef` stays authoritative, verified the CSS transition still applies
identically regardless of write path), and `bun run verify` was clean
after. But it was not tested against the ghosting symptom specifically,
because at the time ghosting wasn't in scope. **Worth a deliberate A/B**:
temporarily revert to the old `setLayout`-per-move approach (in git
history, same commit's parent) and see if ghosting frequency/character
changes. If it does, that's a real signal this timing change matters to
the WebKit-side bug, even if the "fix" direction isn't obvious yet.

### 3. Windowed-mode window made opaque — commit `eb41568`

**Targeted windowed mode (Wayland) specifically, based on the original bug
report before the X11/overlay clarification.** Removed `.transparent(true)`
from the `screen-0` window in `lib.rs`, changed `App.css`'s
`--wigl-windowed-bg` gradient to fully-opaque stops instead of fading to
alpha 0. Reasoning: WebKitGTK's compositor doesn't reliably clear a
transparent GTK window's backing store between paints; windowed mode's
transparency was purely decorative (confirmed via the code comment/git
history), so removing it removes a whole class of risk for free.

**This has never been confirmed to fix anything**, because:
- It only touches the windowed-mode code path.
- The owner's actual repro machine is X11 → runs **overlay mode**, a
  completely different (and still-transparent, necessarily so — the
  desktop-glued look requires it) window setup. This fix literally cannot
  affect what they were testing.
- Nobody has since tested it on real Wayland/GNOME hardware, which is the
  only place it could matter.

**Do not assume this is "done."** It's a reasonable, low-risk change that
should stay, but it's unverified either way. If someone gets access to real
Wayland/GNOME hardware, that's the one test this change is actually for.

### 4. Cursor poller moved onto the main thread — commit `631dd85`

Found while chasing a **crash** (SIGABRT, `malloc(): smallbin double linked
list corrupted`) that the owner hit while QA'ing the ghosting behavior on
X11/overlay. Root cause: `spawn_cursor_poller` in `lib.rs` called
`cursor_position()` / `outer_position()` / `set_ignore_cursor_events()`
straight from its own background thread. GTK is not thread-safe.
`spawn_monitor_poller`, defined right above it in the same file, already
wraps its own window-touching call in `app.run_on_main_thread(...)` — the
cursor poller never got the same treatment. This is **pre-existing code**,
confirmed via `git log -p -- src-tauri/src/lib.rs`, not introduced this
session.

Fixed by wrapping the whole per-tick body in `run_on_main_thread`, moving
the `ignoring: HashMap<String, bool>` state to `Arc<Mutex<_>>` since the
closure now outlives a single loop iteration.

**Confirmed**: fixes a real, reproducible-in-principle thread-safety bug
(heap corruption is a legitimate consequence of concurrent unsynchronized
GTK access, this isn't a guess about mechanism). Compiled clean, `bun run
verify` clean, process stayed alive 20+ seconds idle with no crash.

**Not confirmed**: whether this was *the* cause of the crash the owner
specifically hit (didn't get a backtrace — see "What wasn't possible to do
this session" below), and whether it has anything to do with the ghosting
at all. The connective-tissue theory — a racy `set_ignore_cursor_events`
call corrupting or missing an invalidation, which could plausibly look like
"pixels not cleared" — is **speculation**, stated as speculation when
reported to the owner. After this fix landed, **the owner retested and
ghosting was still present.** So either:
  (a) this wasn't the (or wasn't the only) cause of the ghosting, or
  (b) it's a contributing factor but not sufficient alone, or
  (c) it only ever caused the crash, and the ghosting is unrelated.

No way to distinguish these from this machine alone yet.

## What wasn't possible to do this session (tooling gaps)

- **No real mouse/keyboard control over this box's actual X11 desktop.**
  `mcp__Claude_Browser__*` tools drive an in-app browser, not the host
  desktop. No `xdotool`/`wmctrl` installed (checked, absent). Could not
  script a drag-and-click repro to reproduce the crash or ghosting
  independently — every finding here came from static code reading, git
  history, build/compile verification, and the owner's own testing.
- **No usable core dump for the crash.** `coredumpctl` isn't installed
  (this box uses `apport`, not systemd-coredump). `ulimit -c` was `0` in
  the shell that ran `bun run qa`, so despite bash printing "Aborted (core
  dumped)", no core file was actually written (`/var/crash/` has no `wigl`
  entry, only unrelated older crashes from other apps). **If this
  recurs**, get a real backtrace before guessing further:
  ```bash
  ulimit -c unlimited
  bun run qa   # reproduce the crash
  # then, assuming apport or a plain core file lands:
  gdb src-tauri/target/debug/wigl <core-file> -batch -ex bt
  ```
  Or run the binary directly under gdb and let it catch the signal live:
  ```bash
  cd src-tauri && cargo build --features tauri/custom-protocol
  gdb --args ./target/debug/wigl
  # (gdb) run
  # ... reproduce in the GUI ...
  # (gdb) bt          # once it aborts
  ```
- Could not verify the "10s idle + cursor move clears it" behavior firsthand
  — purely the owner's report. Nobody has tried to correlate it with
  anything (X11 `Expose` events via `xtrace`/`journalctl`, WebKit's own
  frame-clock/idle-repaint logic, GTK's `queue_draw` timing, etc.).

## Most promising unexplored lead

The idle/click asymmetry the owner described is oddly specific and hasn't
been chased at all:

> drag a widget, then wait ~10s and move the cursor → clears
> drag a widget, then keep clicking on it → never clears

Cursor *motion* after a pause fixes it; *clicks* don't. That's not "any
input fixes it" (rules out a generic "any event pumps the loop" theory) and
it's not "nothing fixes it short of restart" either. Things worth checking,
roughly in order of how cheap they are to try:

1. Is there anything in this codebase's cursor poller (`spawn_cursor_poller`,
   30Hz, now on the main thread as of `631dd85`) whose *effect* only
   manifests after enough idle ticks accumulate, or that behaves
   differently after a drag ends vs. mid-interaction? It polls
   unconditionally except while `DragActive` — read through it again with
   this specific behavior in mind, not just the thread-safety angle.
2. GTK/WebKit frame clock: some compositor paths throttle/coalesce repaints
   and only flush on specific event types (motion vs. button). If
   `WEBKIT_DISABLE_COMPOSITING_MODE=1 bun run qa` changes the *character* of
   the bug (not just "still happens") that's a strong signal it's WebKit's
   own compositor's damage/paint scheduling, not GTK window-level
   transparency at all.
3. `journalctl --user -b 0 | grep -i webkit` while reproducing both the
   "clears" and "doesn't clear" cases — compare what's logged in each, if
   anything.
4. Whether `xdotool` or similar can be installed on a real repro machine to
   script "click N times" vs "move cursor after Nms idle" precisely and
   correlate with X11-level `Expose`/`Damage` events via `xtrace`. This is
   the only way to get a truly mechanical answer instead of more theories.

## What's already been ruled out or is low-suspicion

- **Not caused by `React.memo`/imperative-drag refactor being "wrong" in a
  functional sense** — verified extensively (typecheck, build, `bun run
  verify`, careful manual trace of `layoutRef` consistency across every
  branch of the drag state machine). It's *possibly* relevant as a timing
  change (see item 2 above), but there's no bug in it as written.
- **Not the windowed-mode `transparent(true)`** for the owner's actual
  repro (overlay mode, X11) — different code path entirely, untouched.
- **DMA-BUF renderer** — already disabled by default on Linux
  (`WEBKIT_DISABLE_DMABUF_RENDERER=1`, set in `lib.rs`'s `run()` unless the
  user overrides it; confirmed present in every launch log this session:
  `WEBKIT_DISABLE_DMABUF_RENDERER=Ok("1")`). Already the documented
  workaround for a *different* symptom (blank window), kept here because
  it's presumably still needed for that, but it does **not** fix this
  symptom, so DMA-BUF itself is probably not the culprit (or isn't the
  whole story).

## Prior investigation already in `TODO.md` — read this too

`TODO.md`'s Linux section already has real prior work on this exact bug,
from a different session using headless XTest synthetic-input automation
(not real hardware). Don't re-derive what's already there:

- Overlay-mode drag was tested via synthetic XTest input and showed **no
  residue** in that environment — meaning whatever's happening on the
  owner's real hardware may need real GPU-accelerated compositing to
  manifest at all (synthetic-input test environments sometimes fall back to
  software rendering, which wouldn't hit a hardware-compositor-timing bug).
  This is a meaningful environment difference to keep in mind: **synthetic
  reproduction has so far failed to show the bug that real hardware
  reliably shows.**
- The existing (pre-this-session) TODO entry for windowed-mode ghosting
  lists the same three experiments independently arrived at above
  (`WEBKIT_DISABLE_DMABUF_RENDERER=`, `WEBKIT_DISABLE_COMPOSITING_MODE=1`,
  `journalctl` grep for webkit) — still unrun on real Wayland hardware as
  far as this file's author knows.
- There's also an unrelated-but-nearby open item about the windowed window
  spontaneously growing past its configured size on one long-lived process
  — probably not connected to ghosting, flagged in `TODO.md` on its own,
  not duplicated here.

## Debugging commands used this session (for reference)

```bash
# Full build+relaunch+log-check loop (what "verify" means throughout this doc)
bun run verify

# Fast iteration without packaging (what the owner used to reproduce)
bun run qa            # auto-detects overlay (X11/macOS) vs windowed (Wayland)
bun run qa:app        # forces windowed mode everywhere

# Rust build directly, matching what qa.sh/verify.sh do under the hood —
# needed because plain `cargo` on this box resolves to a version that
# can't read the lockfile; prefer rustup's:
export PATH="$(rustup which cargo | xargs dirname):$PATH"
cd src-tauri && cargo build --features tauri/custom-protocol

# Check which window flow will trigger (look at the first stderr line
# every launch prints):
# "[wigl] mode: overlay|windowed (WIGL_MODE=..., XDG_SESSION_TYPE=..., ...)"

# Compositing manager check (X11) — see "Environment" above
DISPLAY=:0 xprop -root _NET_WM_CM_S0

# Crash forensics groundwork (no crash reproduced this session after the
# thread-safety fix, so this was never completed — see gaps above)
ulimit -c unlimited
coredumpctl list          # not installed on this box (apport instead)
ls /var/crash/            # apport's crash dir; check for a fresh wigl entry
```

## Suggested order of attack for the next agent

1. Get onto (or get access to a screen-share/video from) the owner's actual
   machine, or at minimum find out if it's X11 or Wayland and whether it
   has an active compositor (`DISPLAY=:0 xprop -root _NET_WM_CM_S0` on X11).
   Static analysis has been squeezed dry; this needs real hardware
   observation now.
2. If X11 with no compositor confirmed on their machine too: test the
   compositor hypothesis directly (temporarily run one, see if it changes
   anything). Cheap, decisive, hasn't been tried.
3. Chase the idle-vs-click asymmetry (see "Most promising unexplored lead")
   — it's the most specific, least-theorized clue available and likely
   points straight at the actual mechanism once understood.
4. Only after 1–3: consider whether the imperative-drag timing change
   (`4e38ad5`) needs adjusting — e.g. forcing a periodic full repaint nudge
   during drag as a deliberate workaround, if the real WebKit/X11 bug can't
   be fixed at the source. Don't reach for this first; it'd be
   papering over a lower-level bug without understanding it.
