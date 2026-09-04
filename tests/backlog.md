# Tests backlog

Pending automated coverage for `src/wigl` (core) — not a priority-ordered
roadmap, not a place to log every bug. See `AGENTS.md`'s "Testing" section
for what belongs here versus what doesn't, and `docs/testing.md` for the
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

- **`applyGridOverrides` in `src/wigl/grid/config.ts`.** New: Settings > Grid
  went from Tier-2/restart to live — it writes a `useStorage("wigl_grid")`
  row that `Desktop.tsx` feeds to `applyGridOverrides`, which mutates the
  shared `TILING` object in place and falls each field back to a module-load
  snapshot (`GRID_DEFAULTS`) when absent. Worth one test: pass `{cell: 100,
  padding: {top: 5}}` then `{}` and assert `TILING` ends back at the exact
  defaults both for the scalars and the `padding` object (the `{}` = full
  reset contract is the easy thing to regress — a naive `Object.assign`
  merge would leave `cell` at 100). Pure function, no DOM.

- **`buildModel` grouping + `signatureOf` stability in `src/wigl/menu/native.ts`.**
  New: the system-tray menu is assembled from the `useGlobalActions`
  registry — `buildModel(actions, viewEntries)` splits actions into
  root/view/window by their optional `group` field (no group = root), and
  `signatureOf` produces the string the sync effect diffs against so an
  unrelated Desktop re-render (a drag) doesn't rebuild the native menu.
  Worth one test each: (1) actions with `group: "view"`/`"window"`/none land
  in the right buckets and `viewEntries` are prepended to `view`; (2)
  `signatureOf` is unchanged when only an entry's `run` identity changes
  (drag churn) but changes when a `label` or `checked` flips. Pure
  functions, no DOM/Tauri — but both are currently unexported, so this needs
  a small `export` or a test-only entry point first. The commit that added
  `src/wigl/menu/native.ts` is the context.

- **Corner resize (two-axis) in `Desktop.tsx`'s `onResizeMove`.** Edge resize
  (`tests/desktop-resize.test.ts`) only exercises single-axis handles ("e",
  "w"). Corner handles ("ne"/"nw"/"se"/"sw") now exist and rely on the same
  function applying both the col-axis and row-axis branches in one move
  (`r.edge.includes("e"|"w")` and `r.edge.includes("n"|"s")` independently,
  not mutually exclusive like the old single-edge `if/else if` chain) — a
  regression here would silently drop one axis on a diagonal drag rather
  than throwing. Worth one test: drag a "se" handle diagonally and assert
  both `w` and `h` grew together (same fixture/pitch-math pattern as the
  existing east/west tests).

- **`repack` and un-hide reflow (`src/wigl/grid/math.ts` + `Desktop.tsx`'s
  `setClosed`).** Two related fixes landed together. (1) `repack(items, cols)`
  re-places every visible item first-fit top-left — unlike `settle` it also
  pulls a *non-overlapping* item that drifted off-screen back toward 0,0;
  it's what "Reset layout" (`doReset`) now runs instead of wiping
  `widget_layout`, so hidden widgets must stay hidden and keep their stored
  spot. (2) `setClosed(id, false)` now runs `reflow` against the re-shown
  item so a widget un-hidden onto a cell another widget has taken over gets
  the others pushed off it (repro: move A to 0,0, hide A, move B to 0,0,
  show A → B should reflow away). Worth one test each on the pure math:
  `repack` moves a lone item at row 99 to row 0 and leaves a `hidden` item
  untouched; `reflow(items, shownItem, cols)` displaces an overlapping
  sibling. Same fixture pattern as the existing `settle`/`reflow` tests.

- **Cross-monitor "show" adoption in `Desktop.tsx`'s `setClosed`.** Fixed
  B15 (see the commit that removed it from `backlog.md`, alongside this
  entry): showing a closed widget from a monitor that isn't its owner
  (`saved[id].m`) used to silently no-op — that monitor's own `layout` never
  contained the id at all (`placeItem` skips any id whose `saved[id].m`
  isn't this monitor, both at build and in the "missing ids" reconcile
  effect), so the plain hidden-flip path had nothing to flip, and nothing
  rendered until a reload. `setClosed` now detects `!closed && prev &&
  !prev.some(it => it.id === id)` and adopts the widget locally instead —
  `autoPlace`s it into this monitor's own layout and rewrites
  `saved[id].m` to this monitor in the same `setSaved` write, mirroring the
  `wigl-drop` cross-monitor drag-drop adoption pattern just without the
  actual drag transaction. Worth one test on `setClosed` (needs a
  lightweight harness/mock around `layoutRef`/`savedRef`/`setLayout`/
  `setSaved`, or extracting the adoption branch into a pure helper first):
  given a `saved` record where `id`'s `m` is monitor 0 and `prev` (monitor
  1's own layout) doesn't contain `id`, calling `setClosed(id, false)` on
  monitor 1 should place `id` into monitor 1's layout with `hidden: false`
  and end up with `saved[id].m === 1`.
