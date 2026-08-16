#!/usr/bin/env python3
"""Watch XDamage events on the overlay window while a drag runs.

The compositor only re-uploads the parts of a window's backing pixmap that
X reports as damaged. If the pixmap's contents change but no damage event
covers that area, the compositor keeps showing stale pixels — that's the
ghosting symptom. This prints the damaged rects so they can be compared
against the region that actually changed.

    python3 scripts/dev/damage-watch.py <seconds> [dragX dragY dx dy]
"""

import ctypes
import ctypes.util
import importlib.util
import os
import sys
import threading
import time

_spec = importlib.util.spec_from_file_location(
    "gp", os.path.join(os.path.dirname(os.path.abspath(__file__)), "ghost-probe.py"))
gp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gp)

xdamage = ctypes.CDLL(ctypes.util.find_library("Xdamage"))
x11 = gp.x11

XDamageReportRawRectangles = 0


class XEvent(ctypes.Structure):
    _fields_ = [("pad", ctypes.c_long * 32)]


class XDamageNotifyEvent(ctypes.Structure):
    _fields_ = [
        ("type", ctypes.c_int), ("serial", ctypes.c_ulong), ("send_event", ctypes.c_int),
        ("display", ctypes.c_void_p), ("damage", ctypes.c_ulong), ("level", ctypes.c_int),
        ("more", ctypes.c_int), ("timestamp", ctypes.c_ulong),
        ("drawable", ctypes.c_ulong),
        ("ax", ctypes.c_short), ("ay", ctypes.c_short),
        ("aw", ctypes.c_ushort), ("ah", ctypes.c_ushort),
        ("gx", ctypes.c_short), ("gy", ctypes.c_short),
        ("gw", ctypes.c_ushort), ("gh", ctypes.c_ushort),
    ]


xdamage.XDamageQueryExtension.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int)]
xdamage.XDamageCreate.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int]
xdamage.XDamageCreate.restype = ctypes.c_ulong
x11.XNextEvent.argtypes = [ctypes.c_void_p, ctypes.POINTER(XEvent)]
x11.XPending.argtypes = [ctypes.c_void_p]


def main():
    secs = float(sys.argv[1])
    # a separate display connection: the drag helpers use gp.dpy
    dpy = x11.XOpenDisplay(b":0")
    win = None
    for w, name, a in gp.find_wigl():
        if "screen" in name and a.map_state == 2:
            win, wa = w, a
    ev_base = ctypes.c_int(); err_base = ctypes.c_int()
    if not xdamage.XDamageQueryExtension(dpy, ctypes.byref(ev_base), ctypes.byref(err_base)):
        sys.exit("no XDamage extension")
    xdamage.XDamageCreate(dpy, win, XDamageReportRawRectangles)
    x11.XFlush(dpy)
    print(f"watching damage on 0x{win:x} ({wa.width}x{wa.height}) for {secs}s")

    if len(sys.argv) > 2:
        gx, gy, dx, dy = (int(v) for v in sys.argv[2:6])
        threading.Thread(target=lambda: (time.sleep(1.0), gp.smooth_drag(gx, gy, dx, dy)),
                         daemon=True).start()

    deadline = time.time() + secs
    ev = XEvent()
    rects = []
    while time.time() < deadline:
        if not x11.XPending(dpy):
            time.sleep(0.005)
            continue
        x11.XNextEvent(dpy, ctypes.byref(ev))
        if ev.pad[0] & 0x7F != ev_base.value + 0:
            continue
        d = ctypes.cast(ctypes.byref(ev), ctypes.POINTER(XDamageNotifyEvent)).contents
        rects.append((time.time(), d.ax, d.ay, d.aw, d.ah))

    print(f"{len(rects)} damage rects")
    if rects:
        t0 = rects[0][0]
        for t, x, y, w, h in rects[:40]:
            print(f"  +{t-t0:6.3f}s  {w}x{h}+{x}+{y}")
        if len(rects) > 40:
            print(f"  ... {len(rects)-40} more")
        xs = min(r[1] for r in rects); ys = min(r[2] for r in rects)
        xe = max(r[1] + r[3] for r in rects); ye = max(r[2] + r[4] for r in rects)
        print(f"union bbox: {xe-xs}x{ye-ys}+{xs}+{ys}")
        print(f"last damage at +{rects[-1][0]-t0:.3f}s")


if __name__ == "__main__":
    main()
