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

- **Un-hide reflow in `Desktop.tsx`'s `setClosed` (the non-adoption path).**
  `setClosed(id, false)` runs `reflow` against the re-shown item so a widget
  un-hidden onto a cell another widget has taken over gets the others pushed
  off it, *and persists where they land* so the fix survives a restart
  (repro: move A to 0,0, hide A, move B to 0,0, show A → B should reflow
  away and stay away after relaunch). The pure `reflow`/`repack`/`settle`
  math is now covered in `tests/grid-math.test.ts`; what's still untested is
  `setClosed` wiring that math into a `setLayout` + `setSaved` write for the
  non-cross-monitor case. Needs the same lightweight `layoutRef`/`savedRef`
  harness the cross-monitor `setClosed` entry below calls for — do both in
  one pass.

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

- **F8's double-click-resize-mode state machine in `Desktop.tsx`.** New:
  double-clicking a `data-resize-handle` (`onResizeDoubleClick`) now arms
  `resize.current` without pointer capture and flips `resizeClickMode` on,
  instead of requiring the click-drag `onResizeStart` path; a window
  `pointermove`/`pointerdown`(capture)/`keydown` effect then drives the same
  `onResizeMove`/`endResize` a real click-drag uses, and Escape reverts to
  `resize.current.snapshot` (mirrors the drag-abandon revert in the stuck-
  transaction watchdog further down the file). No real pointer/DOM
  automation needed — the state machine itself is pure enough to unit-test
  directly: (1) after arming, a plain `onResizeMove` call previews the new
  size without touching storage; (2) a synthetic `keydown` with `key:
  "Escape"` restores the pre-resize snapshot into `layout` and clears
  `resize.current`/`resizeClickMode` without ever calling `setSaved`; (3) a
  synthetic `pointerdown` commits via `endResize` (same `setSaved` shape the
  existing click-drag resize test already asserts on). Worth extending
  `tests/desktop-resize.test.ts` with a second `test()` using its same
  fixture/dispatch pattern, subbing `dblclick`+window-level events for the
  handle's `pointerdown`+`pointermove`+`pointerup` sequence.

- **`useQuery` (`src/wigl/hooks/useQuery.ts`) — has no coverage at all.**
  The shared async cache every widget (and `useUploader`, indirectly) can
  lean on. Four invariants worth one test each, all reachable with the
  `mock-storage` tier (`useSql: true` rides the same mocked kv table
  `useStorage` does): (1) two callers with the same `key` mounted together
  fire `fn` once, not twice (in-flight dedup via the `inflight` Map); (2) a
  result inside `stale` ms is served from `memoryCache` without calling
  `fn` again; (3) `refresh()` forces a refetch past a still-fresh cache and
  updates every reader of that key; (4) `useSql: true` round-trips through
  `query_<key>` and a second mount reads the persisted value before `fn`
  resolves. `memoryCache`/`inflight` are module globals with no reset hook —
  a test needs unique keys per case (same as the hook's real usage).

- **`useMonitors` (`src/wigl/Desktop/useMonitors.ts`) monitor-list
  normalization.** `refreshMonitors` is the one bit of logic in an otherwise
  thin Tauri wrapper: it sorts `availableMonitors()` left-to-right (`x`,
  then `y`) and divides every rect field by that monitor's `scaleFactor` so
  the shared logical-space coords the drag hit-test relies on are correct on
  HiDPI (Retina `scaleFactor: 2`, Linux fractional scaling). A regression
  here silently offsets every cross-monitor drop on a scaled display. Hard
  to unit-test as-is (the transform is inline in a `useCallback` over a
  mocked `availableMonitors`); worth extracting the `ms => MonitorRect[]`
  mapping into a pure exported helper first, then one test: unsorted input
  with a `scaleFactor: 2` monitor in → sorted, scale-normalized rects out.

- **`useCrossMonitorSync` (`src/wigl/Desktop/useCrossMonitorSync.ts`) —
  the *receiving* side of a cross-monitor drag.** `tests/desktop-drag.test.ts`
  covers the *sending* monitor (the `wigl-preview`/`wigl-drop` it emits);
  nothing drives those events *into* a second monitor's `useCrossMonitorSync`
  and asserts the result. Three things to pin, all via a `<Desktop
  monitorIndex={1}>` render fed synthetic `wigl-preview`/`wigl-drop`/
  `wigl-reset` events (the `mock-storage` mock already relays Tauri events
  in-process): (1) an incoming `wigl-preview` for this monitor renders a
  phantom and `reflow`s the real widgets around it off a pre-preview
  snapshot; (2) a `wigl-preview` that moves to another monitor (`p.to !==
  monitorIndex`) restores that snapshot exactly (`clearForeign`); (3) a
  `wigl-drop` for this monitor adopts the widget into `layout` + persists it
  once, and a drop elsewhere doesn't.

- **`reportGrid` deferred-settle in `src/wigl/Desktop/useWidgetLayout.ts`.**
  A never-before-seen widget (no saved position) is added to
  `pendingReports`; `reportGrid` holds off `settle`ing the layout until
  *every* pending widget has reported its real size at least once, then does
  one `settle` pass — so the final layout is deterministic regardless of
  which widget's `<Widget>` effect fired first (see the effect's own
  comment, and the `backlog` note it references). Worth one test through a
  `<Desktop>` render with two brand-new widgets reporting sizes in both
  orders and asserting identical final positions. Needs a widget stub that
  calls its `report` slot callback with a chosen `w/h` — the resize test's
  fixture pattern plus a `useEffect(() => slot.report({w,h}))`.

- **`generateParametricColors` in `src/wigl/theme/parametric.ts` — no
  coverage.** Pure function, ~20 derived tokens from 6 knobs, used
  app-wide (Settings > Appearance's parametric mode writes the knobs live).
  A regression is silent and only shows as "the theme looks off". Worth a
  small test: (1) `DEFAULT_KNOBS` in → every `ThemeColors` key present and a
  valid `oklch(...)`/`#hex` string (no `NaN`, culori didn't choke); (2) the
  light/dark pivot holds — `brightness: 0.05` gives a `background` lightness
  below `foreground`'s, `brightness: 0.95` flips it — since that `isDarkBg`
  branch drives every elevation formula; (3) `saturation: 0` leaves
  `secondary`/`background` near-gray (chroma ≤ `SURFACE_CHROMA`). Parse the
  returned strings with `culori`'s own `oklch()` — it's already a dep.
