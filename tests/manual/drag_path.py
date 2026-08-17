"""Pure point-interpolation for any manual script that drives a long,
direction-changing drag — no platform code, no side effects. Shared so
every drag-probe script (X11's ghost-probe.py, macOS's
cross-monitor-drag-probe.py, ...) walks a path the same way instead of each
reinventing its own step math.

A short straight synthetic line has repeatedly failed to reproduce drag
bugs a real hand-driven drag shows (see ghost-probe.py's own history) —
`interpolate` is what turns a handful of waypoints into that longer,
direction-changing path.
"""


def interpolate(waypoints, step_px=12):
    """`waypoints` is `[(x0, y0), (x1, y1), ...]` — at least the start and
    one target point. Returns every intermediate point (excluding the
    start, including each waypoint) spaced ~`step_px` apart along each
    straight segment, so a caller can motion/move through them one at a
    time instead of jumping straight to each waypoint."""
    if len(waypoints) < 2:
        raise ValueError("interpolate needs at least a start and one target point")

    path = []
    cx, cy = waypoints[0]
    for tx, ty in waypoints[1:]:
        steps = max(2, int(max(abs(tx - cx), abs(ty - cy)) / step_px))
        for i in range(1, steps + 1):
            path.append((cx + (tx - cx) * i / steps, cy + (ty - cy) * i / steps))
        cx, cy = tx, ty
    return path


if __name__ == "__main__":
    # No input, no display needed — run directly to sanity-check the math:
    # python3 tests/manual/drag_path.py
    p = interpolate([(0, 0), (100, 0), (100, 50)], step_px=10)
    assert p[-1] == (100, 50), "must end exactly on the last waypoint"
    assert all(0 <= x <= 100 and 0 <= y <= 50 for x, y in p), "must stay within the waypoint bounds"
    assert len(p) >= 10, "expected roughly one point per step_px along ~150px of travel"
    print(f"ok — {len(p)} points across 2 segments")
