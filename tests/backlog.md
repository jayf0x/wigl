# Tests backlog

Pending automated coverage for `src/wigl` (core) — not a priority-ordered
roadmap, not a place to log every bug. See `AGENTS.md`'s "Testing" section
for what belongs here versus what doesn't, and `tests/README.md` for the
actual test infrastructure.

Each entry is something a test-writing pass (an agent, a subagent it
spawns, or a human) can pick up and turn into a real `*.test.ts` file
without having to re-derive the bug/behavior from scratch — enough context
to write the test, not the test itself.

Rules for keeping this file real (same spirit as `backlog.md`):

- One entry per capability worth covering, not one per commit. If a second
  entry would test the exact same code path as an existing one, extend that
  entry's description instead of adding a new one.
- Include: what to test, why it matters, and a pointer (commit hash and/or
  file) to the real context — not speculative "might be nice" coverage.
- When an entry becomes a real test, delete it. The test file (and its own
  comments, pointing back at the commit/bug if relevant) is the record —
  this file is a queue, not a changelog.
- No dates, no "as of this session" — describes what's missing right now.

## Queue

- **Drag coordinate correction across monitors (B8).** `Desktop.tsx`'s
  `onPointerDown`/`onPointerMove` — `DragState.screenCorrection`, computed
  once at drag start from `clientY` against the drag-origin monitor's own
  `y`, then applied to every subsequent `screenX`/`screenY` read for that
  drag. Real bug, fixed in commit `0f792ec` after a live repro showed
  `PointerEvent.screenY` is window-relative to the *capturing* window during
  a cross-monitor drag, not a true global coordinate (screenX has no such
  issue). Test shape: synthesize `pointerdown` + a few `pointermove`s (real
  `PointerEvent`s work fine in happy-dom — see `tests/dom.demo.test.ts`)
  against two mocked monitors at
  different `y` offsets (e.g. one at `y: 0`, one at `y: -388`, matching the
  real repro), and assert the computed `col`/`row` on the foreign monitor
  match what a correct conversion would give — not the exact live numbers
  from the repro, since those were specific to that display arrangement,
  but the *shape*: a monitor offset in y must not distort where the widget
  lands, regardless of which axis or direction. Needs `Desktop` mountable
  in isolation (single monitor's own `<Desktop monitorIndex>` instance,
  `monitors.current` seeded via whatever seam `availableMonitors()` goes
  through today — check if that needs its own small mock).
- **Lazy per-icon lucide-react loading (B14).** `src/wigl/plugins/lucide-lazy.ts`'s
  `nameToKebab` derivation + the `lucideLazy` Proxy — fixed in commit
  `717609d`. Test shape: assert the Proxy resolves both a plain name
  (`ChevronDown`) and its "Icon"-suffixed current-style alias
  (`ChevronDownIcon`) to a component, returns `undefined` for an unknown
  name, and — the actual regression this guards — that accessing a name
  does *not* eagerly import every icon (e.g. spy/count dynamic `import()`
  calls, or just assert the returned component is the *same* lazy wrapper
  both times rather than a freshly-resolved one, proving no per-access
  re-derivation of the whole map).
