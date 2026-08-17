#!/usr/bin/env python3
"""Dump the display-stack facts that decide how this machine renders.

Read this *before* theorising about any Linux rendering/perf bug. A whole
session was once spent on a "there is no compositor running" theory that was
purely an artifact of checking it the wrong way, and on a "stale pixel band"
that turned out to be the Ubuntu dock. Both are answered here in one command.

    python3 tests/manual/x11-report.py

Touches no input and changes nothing — safe to run any time.
"""

import ctypes
import ctypes.util
import os
import re
import shutil
import subprocess
import sys

x11 = ctypes.CDLL(ctypes.util.find_library("X11"))
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
x11.XInternAtom.restype = ctypes.c_ulong
x11.XGetSelectionOwner.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XGetSelectionOwner.restype = ctypes.c_ulong

DISPLAY = os.environ.get("DISPLAY", ":0")


def sh(cmd):
    try:
        return subprocess.run(cmd, shell=True, capture_output=True, text=True,
                              timeout=10).stdout.strip()
    except Exception as e:
        return f"(failed: {e})"


def section(title):
    print(f"\n=== {title} ===")


def main():
    section("session")
    for var in ("XDG_SESSION_TYPE", "XDG_CURRENT_DESKTOP", "WAYLAND_DISPLAY",
                "DISPLAY", "XDG_SESSION_DESKTOP"):
        print(f"  {var}={os.environ.get(var, '(unset)')}")
    print(f"  loginctl type: {sh('loginctl show-session $(loginctl list-sessions --no-legend | awk \"{print \\$1; exit}\") -p Type --value')}")
    print(f"  server: {'Xwayland' if sh('pgrep -x Xwayland') else 'Xorg' if sh('pgrep -x Xorg') else '(neither found)'}")

    dpy = x11.XOpenDisplay(DISPLAY.encode())
    if not dpy:
        print(f"\n  cannot open DISPLAY={DISPLAY} — rest of the report needs X11")
        return

    section("compositor")
    # THE correct check. _NET_WM_CM_S<n> is an X *selection*, not a root
    # window property, so `xprop -root _NET_WM_CM_S0` always prints "not
    # found" whether or not a compositor is running. Do not use xprop here.
    owner = x11.XGetSelectionOwner(dpy, x11.XInternAtom(dpy, b"_NET_WM_CM_S0", 0))
    print(f"  _NET_WM_CM_S0 selection owner: {hex(owner) if owner else 'NONE (no compositing manager)'}")
    print("  (note: `xprop -root _NET_WM_CM_S0` is the WRONG check and always says 'not found')")
    print(f"  WM: {sh(f'xprop -id $(xprop -root -notype _NET_SUPPORTING_WM_CHECK | sed \"s/.*# //\") -notype _NET_WM_NAME 2>/dev/null | cut -d= -f2')}")

    section("scaling / framebuffer")
    xr = sh("xrandr --current")
    fb = re.search(r"connected primary (\d+)x(\d+)", xr) or re.search(r"connected (\d+)x(\d+)", xr)
    mode = re.search(r"^\s+(\d+)x(\d+)\s+[\d.]+\*", xr, re.M)
    if fb and mode:
        fw, fh = int(fb.group(1)), int(fb.group(2))
        mw, mh = int(mode.group(1)), int(mode.group(2))
        print(f"  framebuffer {fw}x{fh}   active mode {mw}x{mh}")
        if (fw, fh) != (mw, mh):
            print(f"  *** FRACTIONAL SCALING ACTIVE: rendering {fw*fh/1e6:.1f}MP and")
            print(f"      downscaling to {mw}x{mh} via a RandR transform. Every")
            print(f"      per-frame surface cost scales with the {fw}x{fh} figure,")
            print(f"      not the panel — this is a common 'only on my machine' factor.")
    else:
        print("  (could not parse xrandr)")
    print(f"  Xft.dpi: {sh('xrdb -query | grep -i Xft.dpi') or '(unset)'}")
    print(f"  mutter experimental-features: {sh('gsettings get org.gnome.mutter experimental-features')}")

    section("gpu / renderer")
    print(f"  {sh('glxinfo -B 2>/dev/null | grep -E \"OpenGL renderer|OpenGL version\"') or '(glxinfo not installed)'}")
    print(f"  webkit2gtk: {sh('dpkg -l 2>/dev/null | grep libwebkit2gtk-4.1-0 | awk \"{print \\$3}\"') or '(unknown)'}")
    print(f"  kernel: {sh('uname -r')}")

    section("caveats that have burned people here")
    print("  - gnome-shell draws the Ubuntu dock, notifications and the overview as")
    print("    its OWN actors, not X windows. They never appear in XQueryTree, so any")
    print("    'compare a window's pixels against the screen' check will report them")
    print("    as a persistent mismatch band. That is not the app's bug.")
    print("  - the overlay window is always-on-bottom: every other window legitimately")
    print("    covers it. Mask by stacking order before believing a pixel diff.")


if __name__ == "__main__":
    main()
