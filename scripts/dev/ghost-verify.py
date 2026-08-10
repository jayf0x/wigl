#!/usr/bin/env python3
"""Absolute ghosting check for overlay mode — no baseline, no screenshots.

Wherever the overlay window's own pixel is fully opaque (alpha == 255), the
composited root framebuffer must show that exact RGB. Anything else means
the compositor is presenting stale content for that pixel. That is the
ghosting symptom, measured directly.

    python3 scripts/dev/ghost-verify.py                 # one-shot check
    python3 scripts/dev/ghost-verify.py drag X Y DX DY  # drag, then sample
                                                        # over time (clicks
                                                        # vs. idle vs. motion)

Exit status is 1 if mismatched pixels are found in one-shot mode.
"""

import ctypes
import importlib.util
import os
import sys
import time

_spec = importlib.util.spec_from_file_location(
    "gp", os.path.join(os.path.dirname(os.path.abspath(__file__)), "ghost-probe.py"))
gp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gp)


def overlay():
    for w, name, a in gp.find_wigl():
        if "screen" in name and a.map_state == 2 and a.depth == 32:
            return w, a
    sys.exit("no mapped overlay window — is the app running in overlay mode?")


def grab(drawable, x, y, w, h):
    img = gp.x11.XGetImage(gp.dpy, drawable, x, y, w, h, gp.ALLPLANES, gp.ZPIXMAP).contents
    return ctypes.string_at(img.data, img.bytes_per_line * h), img.bytes_per_line


def occluders(win):
    """Rects of every mapped window stacked above `win` (screen coords).

    The overlay is always-on-bottom, so anything above it legitimately hides
    its pixels — those areas must be excluded or every other window on the
    desktop reads as a ghost.
    """
    r = ctypes.c_ulong(); parent = ctypes.c_ulong()
    kids = ctypes.POINTER(ctypes.c_ulong)(); n = ctypes.c_uint()
    gp.x11.XQueryTree(gp.dpy, gp.root, ctypes.byref(r), ctypes.byref(parent),
                      ctypes.byref(kids), ctypes.byref(n))
    order = [kids[i] for i in range(n.value)]  # bottom-to-top
    # `win` is a child of a reparenting frame in the general case; find the
    # top-level ancestor that appears in the root's child list.
    top = win
    while top not in order:
        rr = ctypes.c_ulong(); pp = ctypes.c_ulong()
        kk = ctypes.POINTER(ctypes.c_ulong)(); nn = ctypes.c_uint()
        if not gp.x11.XQueryTree(gp.dpy, top, ctypes.byref(rr), ctypes.byref(pp),
                                 ctypes.byref(kk), ctypes.byref(nn)) or not pp.value:
            return []
        top = pp.value
    out = []
    for w in order[order.index(top) + 1:]:
        a = gp.geom(w)
        if a and a.map_state == 2 and a.width > 1 and a.height > 1:
            out.append((a.x, a.y, a.x + a.width, a.y + a.height))
    return out


def check(win, wa, step=3, verbose=False):
    # the overlay is 1px shorter than the monitor but offset by wa.y, so its
    # bottom edge can fall past the root window — clamp before XGetImage.
    ra = gp.geom(gp.root)
    h = min(wa.height, ra.height - wa.y)
    w = min(wa.width, ra.width - wa.x)
    # Sandwich the root grab between two window grabs and require the window
    # to be byte-identical across them. Otherwise a widget mid-animation
    # reads as a mismatch purely because the two captures aren't simultaneous.
    for _ in range(40):
        wbuf, ws = grab(win, 0, 0, w, h)
        rbuf, rs = grab(gp.root, wa.x, wa.y, w, h)
        wbuf2, _ = grab(win, 0, 0, w, h)
        if wbuf == wbuf2:
            break
        time.sleep(0.1)
    else:
        print("  (window never went static — sampling anyway)")
    wa = type("A", (), {"width": w, "height": h, "x": wa.x, "y": wa.y})()
    occ = occluders(win)
    opaque = bad = 0
    worst = []
    for y in range(0, wa.height, step):
        wrow, rrow = y * ws, y * rs
        sy = y + wa.y
        rows = [o for o in occ if o[1] <= sy < o[3]]
        for x in range(0, wa.width, step):
            i = wrow + x * 4
            if wbuf[i + 3] != 255:
                continue
            sx = x + wa.x
            if any(o[0] <= sx < o[2] for o in rows):
                continue
            opaque += 1
            j = rrow + x * 4
            # tolerance: compositing rounds premultiplied alpha, so exact
            # equality gives a constant ±1 background hum. A real ghost is a
            # completely different pixel, not a rounding step.
            if max(abs(wbuf[i + k] - rbuf[j + k]) for k in range(3)) > 12:
                bad += 1
                if verbose and len(worst) < 12:
                    worst.append((x, y, tuple(wbuf[i:i + 3]), tuple(rbuf[j:j + 3])))
    return opaque, bad, worst


def main():
    win, wa = overlay()
    if len(sys.argv) > 1 and sys.argv[1] == "drag":
        gx, gy, dx, dy = (int(v) for v in sys.argv[2:6])
        gp.motion(wa.x + wa.width - 5, wa.y + wa.height - 5)
        time.sleep(1.2)
        o, b, _ = check(win, wa)
        print(f"{'before drag':<28} opaque={o:<8} mismatched={b:<8} {100.0*b/max(o,1):5.2f}%")
        gp.smooth_drag(gx, gy, dx, dy)

        def sample(label):
            time.sleep(0.4)
            o, b, _ = check(win, wa)
            print(f"{label:<28} opaque={o:<8} mismatched={b:<8} {100.0*b/max(o,1):5.2f}%")

        sample("t+0.4s after drag")
        time.sleep(2.0)
        sample("after +2s idle")
        for _ in range(6):
            gp.button(1, True); time.sleep(0.05); gp.button(1, False); time.sleep(0.25)
        sample("after 6 clicks, no motion")
        time.sleep(10.0)
        sample("after +10s idle, no input")
        for i in range(30):
            gp.motion(gx + dx + 6 * ((i % 5) - 2), gy + dy + 6 * ((i % 3) - 1))
            time.sleep(0.02)
        sample("after small cursor motion")
        gp.motion(wa.x + wa.width - 5, wa.y + wa.height - 5)
        sample("after cursor moved away")
        return

    o, b, worst = check(win, wa, verbose=True)
    print(f"opaque sampled={o}  mismatched={b}  {100.0 * b / max(o, 1):.2f}%")
    for x, y, wv, rv in worst:
        print(f"  ({x},{y}) window={wv} screen={rv}")
    sys.exit(1 if b else 0)


if __name__ == "__main__":
    main()
