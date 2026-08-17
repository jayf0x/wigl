#!/usr/bin/env python3
"""Measure per-process CPU cost of an identical, bounded scripted drag.

This is the tool that settled the DMA-BUF question: two builds looked the
same on screen and produced identical XDamage output, but one burned ~83%
WebKitWebProcess CPU per drag and the other ~28%. Reach for it whenever the
question is "is change X actually cheaper/more expensive", or "why does this
feel bad only on this machine" — a repeatable number beats an opinion, and a
rendering bug that only shows on big displays usually shows up as cost first.

    python3 tests/manual/perf-drag.py [repeats]

A/B usage — run it against one build/env, then the other, and compare:

    WEBKIT_DISABLE_DMABUF_RENDERER=1 <launch app>; python3 tests/manual/perf-drag.py 3
    <launch app without it>;                       python3 tests/manual/perf-drag.py 3

Same drag path every run (fixed seed) so the numbers are comparable. Bounded
by ghost-probe's synthetic-input budget — see this folder's README.
"""

import importlib.util
import os
import random
import statistics
import subprocess
import sys
import time

_here = os.path.dirname(os.path.abspath(__file__))


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, os.path.join(_here, filename))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


gp = _load("gp", "ghost-probe.py")
wr = _load("wr", "widget-rects.py")

# Processes worth attributing cost to. wigl is the UI process (GTK, the
# compositor-facing side), WebKitWebProcess is where page rendering and
# WebKit's own compositing happen, gnome-shell is the system compositor —
# a change can move cost between these rather than remove it, so watch all.
WATCH = ("wigl", "WebKitWebProces", "gnome-shell")


def pids(name):
    return subprocess.run(["pgrep", "-x", name], capture_output=True,
                          text=True).stdout.split()


def jiffies(ps):
    total = 0
    for p in ps:
        try:
            fields = open(f"/proc/{p}/stat").read().rsplit(")", 1)[1].split()
            total += int(fields[11]) + int(fields[12])  # utime + stime
        except OSError:
            pass
    return total


def one_run(seed):
    procs = {n: pids(n) for n in WATCH}
    wa, rects = wr.rects()
    if not rects:
        sys.exit("no widgets found on screen")
    random.seed(seed)
    x0, y0, x1, y1 = rects[0]
    gx, gy = x1 - 26, y0 + 26
    path = [(random.randint(int(wa.x) + 100, int(wa.x + wa.width) - 100),
             random.randint(int(wa.y) + 100, int(wa.y + wa.height) - 100))
            for _ in range(5)]
    gp.motion(gx, gy)
    time.sleep(0.8)
    before = {n: jiffies(p) for n, p in procs.items()}
    t0 = time.time()
    gp.wander_drag(gx, gy, path, dt=0.006)
    dur = time.time() - t0
    after = {n: jiffies(p) for n, p in procs.items()}
    hz = os.sysconf("SC_CLK_TCK")
    return dur, {n: 100.0 * (after[n] - before[n]) / hz / dur for n in WATCH}


def main():
    repeats = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    results = {n: [] for n in WATCH}
    try:
        for i in range(repeats):
            dur, cpu = one_run(seed=42)  # same path every run, on purpose
            print(f"run {i+1}: {dur:.2f}s  " +
                  "  ".join(f"{n}={cpu[n]:.1f}%" for n in WATCH))
            for n in WATCH:
                results[n].append(cpu[n])
            time.sleep(1.0)
    except gp.BudgetExhausted as e:
        print(f"\nstopped: {e}")
    if results[WATCH[0]]:
        print("\nmedian:")
        for n in WATCH:
            print(f"  {n:<18} {statistics.median(results[n]):6.1f}%")


if __name__ == "__main__":
    main()
