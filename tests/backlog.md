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
