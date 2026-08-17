"""Shared "never leave the machine unusable" guard for any manual script
that seizes real mouse/keyboard input — X11 (ghost-probe.py) and macOS
(cliclick-driven scripts) alike. Not platform-specific itself: you hand it
your own `release()` callback (whatever actually lets go of the button on
your platform), and it enforces the budget + guarantees that callback runs
on a normal exit, Ctrl+C, SIGTERM, or the budget itself expiring.

    from input_budget import BudgetGuard

    def release_all():
        ...  # your platform's "let go of everything" call

    budget = BudgetGuard(release_all)
    budget.check()  # call before every synthetic input call

See this folder's README for why 60s and why budgeted at all.
"""

import atexit
import os
import signal
import sys
import time


class BudgetExhausted(RuntimeError):
    pass


class BudgetGuard:
    def __init__(self, release, env_var="WIGL_PROBE_BUDGET", default_seconds=60.0):
        self.release = release
        self.seconds = float(os.environ.get(env_var, default_seconds))
        self._started = time.time()
        atexit.register(self.release)
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda *_a: (self.release(), sys.exit(130)))

    def left(self):
        return self.seconds - (time.time() - self._started)

    def check(self):
        if self.left() <= 0:
            self.release()
            raise BudgetExhausted(
                f"synthetic input budget of {self.seconds:.0f}s exhausted; "
                "raise WIGL_PROBE_BUDGET only for a bounded, deterministic run"
            )
