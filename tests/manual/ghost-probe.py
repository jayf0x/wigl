#!/usr/bin/env python3
"""Scriptable X11 repro harness for the overlay-mode ghosting bug.

No screenshots to read by eye: it drives a real drag through XTest against
the real X server, then samples the screen with XGetImage and reports
numbers (how many pixels differ from the pre-drag baseline, and where).

Usage (app must already be running, e.g. `bun run qa`):

    python3 scripts/dev/ghost-probe.py windows          # list wigl windows + geometry
    python3 scripts/dev/ghost-probe.py drag X Y DX DY   # drag from X,Y by DX,DY, report residue
    python3 scripts/dev/ghost-probe.py clickafter X Y   # after a drag: click N times, report
    python3 scripts/dev/ghost-probe.py moveafter X Y    # after a drag: idle then move, report
"""

import atexit
import ctypes
import ctypes.util
import os
import signal
import sys
import time

x11 = ctypes.CDLL(ctypes.util.find_library("X11"))
xtst = ctypes.CDLL(ctypes.util.find_library("Xtst"))

# --- input budget -----------------------------------------------------------
# These scripts move the real cursor on the owner's real desktop. Anything
# that holds the pointer hostage makes the machine unusable, so seizing input
# is budgeted, not open-ended: past WIGL_PROBE_BUDGET seconds (default 60)
# every synthetic-input call raises and the button is released. A run that
# needs longer than a minute of dragging is not a test, it's a slot machine —
# find a deterministic trigger instead of waiting for something to happen.
BUDGET_SECONDS = float(os.environ.get("WIGL_PROBE_BUDGET", "60"))
_started = time.time()
_button_down = set()


class BudgetExhausted(RuntimeError):
    pass


def budget_left():
    return BUDGET_SECONDS - (time.time() - _started)


def release_all():
    """Never leave a mouse button stuck down — the desktop becomes unusable."""
    for b in list(_button_down):
        try:
            xtst.XTestFakeButtonEvent(dpy, b, 0, 0)
            x11.XFlush(dpy)
        except Exception:
            pass
        _button_down.discard(b)


def _check_budget():
    if budget_left() <= 0:
        release_all()
        raise BudgetExhausted(
            f"synthetic input budget of {BUDGET_SECONDS:.0f}s exhausted; "
            "raise WIGL_PROBE_BUDGET only for a bounded, deterministic run")


atexit.register(release_all)
for _sig in (signal.SIGINT, signal.SIGTERM):
    signal.signal(_sig, lambda *_: (release_all(), sys.exit(130)))


class XWindowAttributes(ctypes.Structure):
    _fields_ = [
        ("x", ctypes.c_int), ("y", ctypes.c_int),
        ("width", ctypes.c_int), ("height", ctypes.c_int),
        ("border_width", ctypes.c_int), ("depth", ctypes.c_int),
        ("visual", ctypes.c_void_p), ("root", ctypes.c_ulong),
        ("class_", ctypes.c_int), ("bit_gravity", ctypes.c_int),
        ("win_gravity", ctypes.c_int), ("backing_store", ctypes.c_int),
        ("backing_planes", ctypes.c_ulong), ("backing_pixel", ctypes.c_ulong),
        ("save_under", ctypes.c_int), ("colormap", ctypes.c_ulong),
        ("map_installed", ctypes.c_int), ("map_state", ctypes.c_int),
        ("all_event_masks", ctypes.c_long), ("your_event_mask", ctypes.c_long),
        ("do_not_propagate_mask", ctypes.c_long), ("override_redirect", ctypes.c_int),
        ("screen", ctypes.c_void_p),
    ]


class XImage(ctypes.Structure):
    _fields_ = [
        ("width", ctypes.c_int), ("height", ctypes.c_int),
        ("xoffset", ctypes.c_int), ("format", ctypes.c_int),
        ("data", ctypes.c_void_p), ("byte_order", ctypes.c_int),
        ("bitmap_unit", ctypes.c_int), ("bitmap_bit_order", ctypes.c_int),
        ("bitmap_pad", ctypes.c_int), ("depth", ctypes.c_int),
        ("bytes_per_line", ctypes.c_int), ("bits_per_pixel", ctypes.c_int),
        ("red_mask", ctypes.c_ulong), ("green_mask", ctypes.c_ulong),
        ("blue_mask", ctypes.c_ulong),
    ]


x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XDefaultRootWindow.restype = ctypes.c_ulong
x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x11.XGetWindowAttributes.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(XWindowAttributes)]
x11.XGetImage.restype = ctypes.POINTER(XImage)
x11.XGetImage.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int,
                          ctypes.c_uint, ctypes.c_uint, ctypes.c_ulong, ctypes.c_int]
x11.XFetchName.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_char_p)]
x11.XQueryTree.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong),
                           ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.POINTER(ctypes.c_ulong)),
                           ctypes.POINTER(ctypes.c_uint)]
x11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
x11.XInternAtom.restype = ctypes.c_ulong
x11.XGetWindowProperty.argtypes = [
    ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_long, ctypes.c_long,
    ctypes.c_int, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int),
    ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_void_p)]
xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]

ZPIXMAP = 2
ALLPLANES = 0xFFFFFFFF

dpy = x11.XOpenDisplay(b":0")
if not dpy:
    sys.exit("cannot open DISPLAY=:0")
root = x11.XDefaultRootWindow(dpy)


def win_name(w):
    p = ctypes.c_char_p()
    if x11.XFetchName(dpy, w, ctypes.byref(p)) and p.value:
        return p.value.decode("utf8", "replace")
    # fall back to _NET_WM_NAME (UTF8_STRING) — GTK usually sets only this
    atom = x11.XInternAtom(dpy, b"_NET_WM_NAME", 0)
    utf8 = x11.XInternAtom(dpy, b"UTF8_STRING", 0)
    at = ctypes.c_ulong(); fmt = ctypes.c_int()
    n = ctypes.c_ulong(); rem = ctypes.c_ulong(); data = ctypes.c_void_p()
    if x11.XGetWindowProperty(dpy, w, atom, 0, 1024, 0, utf8, ctypes.byref(at),
                              ctypes.byref(fmt), ctypes.byref(n), ctypes.byref(rem),
                              ctypes.byref(data)) == 0 and data:
        return ctypes.string_at(data).decode("utf8", "replace")
    return ""


def walk(w, depth=0):
    r = ctypes.c_ulong(); parent = ctypes.c_ulong()
    kids = ctypes.POINTER(ctypes.c_ulong)()
    n = ctypes.c_uint()
    if not x11.XQueryTree(dpy, w, ctypes.byref(r), ctypes.byref(parent),
                          ctypes.byref(kids), ctypes.byref(n)):
        return
    for i in range(n.value):
        c = kids[i]
        yield c, depth
        yield from walk(c, depth + 1)


def geom(w):
    a = XWindowAttributes()
    if not x11.XGetWindowAttributes(dpy, w, ctypes.byref(a)):
        return None
    return a


def find_wigl():
    out = []
    for w, _ in walk(root):
        name = win_name(w)
        if "wigl" in name.lower():
            a = geom(w)
            if a:
                out.append((w, name, a))
    return out


def grab(x, y, w, h):
    """Capture a screen region from the root window; return raw BGRA bytes."""
    img = x11.XGetImage(dpy, root, x, y, w, h, ALLPLANES, ZPIXMAP)
    if not img:
        return None
    im = img.contents
    buf = ctypes.string_at(im.data, im.bytes_per_line * im.height)
    x11.XDestroyImage(img)
    return buf, im.bytes_per_line, im.bits_per_pixel


def diff(a, b):
    """Count differing pixels between two captures of the same region."""
    ba, stride, bpp = a
    bb, _, _ = b
    px = bpp // 8
    n = 0
    for i in range(0, min(len(ba), len(bb)), px):
        if ba[i:i + 3] != bb[i:i + 3]:
            n += 1
    return n


def motion(x, y):
    _check_budget()
    xtst.XTestFakeMotionEvent(dpy, -1, int(x), int(y), 0)
    x11.XFlush(dpy)


def button(b, down):
    # A release is always allowed through, budget or not — refusing one is
    # how you end up with a stuck mouse button.
    if down:
        _check_budget()
        _button_down.add(b)
    else:
        _button_down.discard(b)
    xtst.XTestFakeButtonEvent(dpy, b, 1 if down else 0, 0)
    x11.XFlush(dpy)


def smooth_drag(x0, y0, dx, dy, steps=40, dt=0.012):
    try:
        motion(x0, y0); time.sleep(0.2)
        button(1, True); time.sleep(0.08)
        for i in range(1, steps + 1):
            motion(x0 + dx * i / steps, y0 + dy * i / steps)
            time.sleep(dt)
    finally:
        button(1, False)


def wander_drag(x0, y0, path, dt=0.008):
    """A long, human-shaped drag: hold the button and wander through `path`
    (a list of absolute points) instead of one straight 0.5s line. Real drags
    last seconds and change direction; a short synthetic line has repeatedly
    failed to reproduce the ghosting this repo is chasing.

    Wrapped so an exhausted input budget still releases the button."""
    try:
        motion(x0, y0); time.sleep(0.3)
        button(1, True); time.sleep(0.1)
        cx, cy = x0, y0
        for tx, ty in path:
            steps = max(2, int(max(abs(tx - cx), abs(ty - cy)) / 12))
            for i in range(1, steps + 1):
                motion(cx + (tx - cx) * i / steps, cy + (ty - cy) * i / steps)
                time.sleep(dt)
            cx, cy = tx, ty
    finally:
        button(1, False)


def report(label, region, base):
    time.sleep(0.35)
    now = grab(*region)
    print(f"{label:<28} differing px vs baseline: {diff(base, now)}")
    return now


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "windows"
    if cmd == "windows":
        for w, name, a in find_wigl():
            print(f"0x{w:x}  {a.width}x{a.height}+{a.x}+{a.y}  depth={a.depth} "
                  f"map={a.map_state} override={a.override_redirect}  {name!r}")
        return

    if cmd == "drag":
        x0, y0, dx, dy = (int(v) for v in sys.argv[2:6])
        pad = 220
        region = (max(0, min(x0, x0 + dx) - pad), max(0, min(y0, y0 + dy) - pad),
                  abs(dx) + pad * 2, abs(dy) + pad * 2)
        # park the cursor far away and let everything settle for a baseline
        motion(region[0] + region[2] + 400, region[1] + region[3] + 400)
        time.sleep(1.5)
        base = grab(*region)
        smooth_drag(x0, y0, dx, dy)
        print("--- after drag, cursor left on the widget ---")
        cur = report("settle 0.5s", region, base)
        time.sleep(2.0)
        report("after +2s idle (no input)", region, base)
        for i in range(6):
            button(1, True); time.sleep(0.05); button(1, False); time.sleep(0.25)
        report("after 6 clicks (no motion)", region, base)
        time.sleep(10.0)
        report("after +10s idle", region, base)
        for i in range(30):
            motion(x0 + dx + 6 * ((i % 5) - 2), y0 + dy + 6 * ((i % 3) - 1))
            time.sleep(0.02)
        report("after small cursor motion", region, base)
        motion(region[0] + region[2] + 400, region[1] + region[3] + 400)
        report("after cursor moved far away", region, base)
        _ = cur
        return

    sys.exit(f"unknown command {cmd!r}")


if __name__ == "__main__":
    main()
