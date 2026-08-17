#!/usr/bin/env python3
"""One-shot, bounded synthetic cross-monitor drag for exercising
Desktop.tsx's drag/foreign-monitor logic (`DragState.screenCorrection` —
see commit 0f792ec in git history for the bug this once caught) without a
screenshot. Moves the REAL cursor via `cliclick` (`brew install cliclick`)
— same caveats as this folder's X11 harness, macOS edition. Requires the
driving terminal/agent to hold macOS Accessibility permission (System
Settings -> Privacy & Security -> Accessibility) — cliclick warns on
stderr if it doesn't.

Usage:
    python3 tests/manual/cross-monitor-drag-probe.py <startX> <startY> <endX> <endY>

startX/Y — a widget's drag-handle grip, in this app's (and cliclick's)
           coordinate space: derive it from `monitors.current[i]`'s origin
           plus the grid math in src/wigl/grid/math.ts (colToPx/rowToPx)
           for that widget's col/row, or temporarily add a one-line dump of
           `getBoundingClientRect()` on `[data-drag-handle]` if eyeballing
           it isn't precise enough. Must be a widget on a monitor with
           nothing else covering it on screen right now — a fully-obscured
           wigl window can't receive the initial pointerdown, only
           continue receiving moves via capture once a drag already
           started elsewhere.
endX/Y   — a point on a different monitor.

The native click-through poller (lib.rs, 30Hz) needs a moment after launch
before a freshly-mounted widget's hit-rect is live — give the app a few
seconds after `bun run qa`/`verify` before the very first probe run, or the
initial move+click will (correctly) find nothing reachable.
"""

import subprocess
import sys

from drag_path import interpolate
from input_budget import BudgetGuard

HARD_TIMEOUT_SECONDS = 15.0


def cg(n):
    """cliclick's absolute-coordinate syntax: a bare negative number is a
    RELATIVE move, so any negative absolute coordinate needs an '=' prefix
    (relevant for any monitor positioned above the primary one)."""
    return f"={n}" if n < 0 else str(n)


def point(x, y):
    return f"{cg(round(x))},{cg(round(y))}"


def main():
    if len(sys.argv) != 5:
        sys.exit(f"usage: {sys.argv[0]} <startX> <startY> <endX> <endY>")
    sx, sy, ex, ey = (int(v) for v in sys.argv[1:5])

    start = point(sx, sy)
    end = point(ex, ey)

    released = {"done": False}

    def release():
        # Never leave the mouse button stuck down — see input_budget.py.
        if not released["done"]:
            released["done"] = True
            subprocess.run(["cliclick", f"du:{end}"], check=False)

    BudgetGuard(release, default_seconds=HARD_TIMEOUT_SECONDS)

    # A few waypoints, not ghost-probe.py's dense human-shaped wander —
    # this is checking coordinate math, not reproducing a rendering bug, so
    # ~4 pointermove events crossing the monitor boundary is plenty.
    quarter_step = max(1, (abs(ex - sx) + abs(ey - sy)) // 4)
    path = interpolate([(sx, sy), (ex, ey)], step_px=quarter_step)
    print(f"targets: start={start} end={end} via {[point(x, y) for x, y in path]}", file=sys.stderr)

    # The native click-through poller (lib.rs, 30Hz) needs a tick to notice
    # the cursor arrived over a widget before it flips the window from
    # click-through to interactive — moving straight into "dd" can otherwise
    # race it and start the drag with nothing to capture the pointer.
    args = [f"m:{start}", "w:100", f"dd:{start}"]
    for x, y in path:
        args += ["w:120", f"dm:{point(x, y)}"]
    args += ["w:150", f"du:{end}"]

    proc = subprocess.Popen(["cliclick", *args])
    try:
        proc.wait(timeout=HARD_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        proc.kill()
        print(f"drag exceeded {HARD_TIMEOUT_SECONDS:.0f}s budget, killed", file=sys.stderr)
    finally:
        release()


if __name__ == "__main__":
    main()
