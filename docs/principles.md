# Code-shape rules

Short and deliberately so — these are already how this codebase is written,
just not written down. Don't pad this file; add a rule here only once it's
been violated or a new agent needed it stated explicitly.

## Functional core, imperative shell

Logic that can be a pure function should be one. Components, hooks, and
Tauri commands stay thin glue around it — call the logic, hold state,
render. This already shows up as: `src/wigl/grid/math.ts` (pure tiling math,
no React), `use<Name>.ts` hooks owning the fetch/poll cycle so `index.tsx`
only renders, `src-tauri/src/lib.rs` commands staying thin wrappers around
whatever they invoke.

Why: pure logic is trivially testable and movable later without dragging a
component or an IPC boundary along with it. Keep new logic there by
default; only inline it in a component/hook when it's genuinely one-line
glue.

## Group by what a module does, not by file type

A folder groups the files for one concern — `src/wigl/grid/` (tiling math +
tunables), `src/wigl/storage/` (the SQLite client). The one deliberate
exception is `src/wigl/hooks/` and `src/wigl/utils/`: every *stateful/React*
helper lives in `hooks/`, every *plain* helper lives in `utils/`, split by
kind rather than by concern, because that split is also the app's import
contract (`@/wigl/hooks` vs. `@/wigl/utils` — see `docs/architecture.md`'s
"What's actually shared"). A module that's both — `relativeTime` (pure
formatting) and `useRelativeTime` (the hook wrapping it) used to be one
file; they're two now, one per barrel, so a widget importing the pure
formatter doesn't drag a `useEffect` subscription in for free.

Outside those two, only split a concern into its own folder once it's more
than one file — a single-file concern stays a flat file at the top level
(`src/wigl/Desktop.tsx`, `src/wigl/widget.tsx`). A folder with one file in
it is a sign the split happened too early.

## `export const`, not `export function`

Prefer `const` (arrow functions) over `function` declarations, especially
for components and hooks: `export const Widget = (props) => ...`, not
`export function Widget(props) { ... }`. This applies inside function
bodies too — local helpers are `const submit = async () => ...`, not
`async function submit() { ... }`.

Why: one declaration form throughout instead of switching styles depending
on whether something is exported or top-level vs. nested; `const` also
forbids the accidental re-declaration `function` allows. The one exception
is a React class component (error boundaries need `componentDidCatch`,
which has no hook equivalent) — those stay `class`.

## Name for what a thing does, not what it abbreviates to

A reader should be able to guess a function's behavior from its name alone,
without opening the file. `sqlLiteral(value)` over `q(s)`; `scanScriptPath()`
over `p()`. This applies to exported, cross-file-visible names — a one-line
callback or a loop index inside a five-line function (`it`, `e`, `i`) doesn't
need the same treatment, since its whole scope is visible in one glance.

Comments explain *why*; names carry *what*. Don't use one to make up for a
bad version of the other — `const q = (s) => ...  // quotes a sql string`
is a worse version of `sqlLiteral`, not an acceptable substitute for it.

## Config lives in one obvious place, and is never hand-duplicated

A tunable constant (poll interval, cache TTL, default source dir) goes in
that widget's `config.ts`, per `docs/widgets.md`. A value that has to match
something else already defined elsewhere (`tauri.conf.json`'s
`identifier`, say) is read from that source at build time — see
`src/config/app.ts` — not retyped as a second string that can silently
drift out of sync. If a config value's origin isn't obvious from where it's
declared, say so in a one-line comment (`// must match X`) rather than
leaving the next reader to guess.

## Promote to shared only on the second real use

One hook used by one widget is over-engineering with extra steps — see
`docs/architecture.md`'s "What's actually shared" for the full promotion
rule. This applies to file layout too: don't pre-create a folder or
abstraction for a concern that has exactly one caller today.
