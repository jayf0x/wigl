#!/usr/bin/env python3
"""Print the overlay's current widget rects (screen coords) and each one's
drag-grip point, derived from the window's own alpha channel.

    python3 scripts/dev/widget-rects.py

The grip is the small square at a widget's top-right corner (see
src/wigl/widget.tsx) — this prints a point inside it, ready to feed to
ghost-metric.py.
"""

import ctypes
import importlib.util
import os

_spec = importlib.util.spec_from_file_location(
    "gp", os.path.join(os.path.dirname(os.path.abspath(__file__)), "ghost-probe.py"))
gp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gp)


def alpha_mask(win, w, h):
    img = gp.x11.XGetImage(gp.dpy, win, 0, 0, w, h, gp.ALLPLANES, gp.ZPIXMAP).contents
    buf = ctypes.string_at(img.data, img.bytes_per_line * h)
    return buf, img.bytes_per_line


def rects():
    win = wa = None
    for w, name, a in gp.find_wigl():
        if "screen" in name and a.map_state == 2:
            win, wa = w, a
    buf, st = alpha_mask(win, wa.width, wa.height)

    def op(x, y):
        return buf[y * st + x * 4 + 3] > 2

    out = []
    seen = []
    step = 8
    for y in range(0, wa.height, step):
        for x in range(0, wa.width, step):
            if not op(x, y) or any(rx0 <= x < rx1 and ry0 <= y < ry1 for rx0, ry0, rx1, ry1 in seen):
                continue
            # grow a box from this seed by walking the opaque run
            x1 = x
            while x1 + 1 < wa.width and op(x1 + 1, y):
                x1 += 1
            x0 = x
            while x0 - 1 >= 0 and op(x0 - 1, y):
                x0 -= 1
            mid = (x0 + x1) // 2
            y1 = y
            while y1 + 1 < wa.height and op(mid, y1 + 1):
                y1 += 1
            y0 = y
            while y0 - 1 >= 0 and op(mid, y0 - 1):
                y0 -= 1
            if x1 - x0 < 40 or y1 - y0 < 40:
                continue
            seen.append((x0, y0, x1, y1))
            out.append((x0 + wa.x, y0 + wa.y, x1 + wa.x, y1 + wa.y))
    return wa, out


def main():
    wa, out = rects()
    print(f"overlay {wa.width}x{wa.height}+{wa.x}+{wa.y}")
    for x0, y0, x1, y1 in out:
        print(f"rect {x1-x0:5d}x{y1-y0:<5d} +{x0}+{y0}   grip=({x1-26},{y0+26})")


if __name__ == "__main__":
    main()
