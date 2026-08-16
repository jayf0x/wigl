#!/bin/bash
# One-shot, bounded synthetic cross-monitor drag for exercising the fix for
# B8 (Desktop.tsx's DragState.screenCorrection — PointerEvent.screenY is
# window-relative, not global, once pointer capture keeps a drag's events
# flowing after the cursor leaves the capturing window) without a
# screenshot. Moves the REAL cursor via `cliclick` (`brew install cliclick`)
# — same caveats as scripts/dev's X11 harness, macOS edition. Requires the
# driving terminal/agent to hold macOS Accessibility permission (System
# Settings → Privacy & Security → Accessibility) — cliclick warns on stderr
# if it doesn't.
#
# Usage: b8-drag-probe.sh <startX> <startY> <endX> <endY>
#   startX/Y — a widget's drag-handle grip, in this app's (and cliclick's)
#              coordinate space: derive it from monitors.current[i]'s
#              origin plus the grid math in src/wigl/grid/math.ts
#              (colToPx/rowToPx) for that widget's col/row, or temporarily
#              add a one-line dump of `getBoundingClientRect()` on
#              `[data-drag-handle]` if eyeballing it isn't precise enough.
#              Must be a widget on a monitor with nothing else covering it
#              on screen right now — a fully-obscured wigl window can't
#              receive the initial pointerdown, only continue receiving
#              moves via capture once a drag already started elsewhere.
#   endX/Y   — a point on a different monitor.
#
# A monitor positioned above the primary one has negative Y in this app's
# (and cliclick's) coordinate space — cliclick treats a bare "-N" as a
# RELATIVE move, not absolute, so any negative coordinate here must go
# through `abscoord` to get its required "=" prefix.
#
# The native click-through poller (lib.rs, 30Hz) needs a moment after
# launch before a freshly-mounted widget's hit-rect is live — give the app
# a few seconds after `bun run qa`/`verify` before the very first probe run,
# or the initial click-through check below will (correctly) report nothing
# reachable.
#
# Hard 15s wall-clock budget, and the mouse button is always released
# (trap on EXIT/INT/TERM) even if something in between fails — this is the
# exact failure mode that once required a reboot to clear.
set -u
[ $# -eq 4 ] || { echo "usage: $0 <startX> <startY> <endX> <endY>" >&2; exit 1; }
SX=$1 SY=$2 EX=$3 EY=$4

abscoord() { [ "$1" -lt 0 ] && echo "=$1" || echo "$1"; }
point() { echo "$(abscoord "$1"),$(abscoord "$2")"; }
lerp() { echo "$(( $1 + ($3 - $1) * $5 / 4 )) $(( $2 + ($4 - $2) * $5 / 4 ))"; }

P1=$(point $(lerp "$SX" "$SY" "$EX" "$EY" 1))
P2=$(point $(lerp "$SX" "$SY" "$EX" "$EY" 2))
P3=$(point $(lerp "$SX" "$SY" "$EX" "$EY" 3))
PE=$(point "$EX" "$EY")
echo "targets: start=$(point "$SX" "$SY") p1=$P1 p2=$P2 p3=$P3 end=$PE" >&2

cleanup() {
  cliclick "du:$PE" >/dev/null 2>&1
}
trap cleanup EXIT INT TERM

(
  # The native click-through poller (lib.rs, 30Hz) needs a tick to notice
  # the cursor arrived over a widget before it flips the window from
  # click-through to interactive — moving straight into `dd` can otherwise
  # race it and start the drag with nothing to capture the pointer.
  cliclick "m:$(point "$SX" "$SY")" "w:100" \
    "dd:$(point "$SX" "$SY")" \
    "w:120" "dm:$P1" \
    "w:120" "dm:$P2" \
    "w:120" "dm:$P3" \
    "w:120" "dm:$PE" \
    "w:150" "du:$PE"
) &
CLICK_PID=$!

i=0
while kill -0 "$CLICK_PID" 2>/dev/null; do
  if [ $i -ge 15 ]; then
    kill -9 "$CLICK_PID" 2>/dev/null
    echo "drag script exceeded 15s budget, killed" >&2
    exit 1
  fi
  sleep 1
  i=$((i + 1))
done
wait "$CLICK_PID"
