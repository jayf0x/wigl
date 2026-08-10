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

## The 80/20 file

A file should read as its one core export — a component, a hook, a
cohesive set of types — with only as much supporting material around it as
that core needs to stay readable. This is a feel, not a formula: a small
widget with a 150-line `index.tsx` and nothing else is completely fine as
one flat file, and forcing it into a `src/` split would be the mistake, not
the fix. The signal worth acting on is a file where the reader has to
scroll past a pile of unrelated form-validation/state-machine/util code to
find the thing they came for — that's when it's grown its own 20% and it's
time to pull that part out, regardless of raw line count:

- Extract logic into a sibling `utils.ts` when there's enough of it to name;
  promote it to `@/wigl/utils` only once a second widget needs the same
  logic (see above). Pure/mathematical helpers especially — they're the
  easiest to test and move once separated.
- Small sub-components or one-off functions that only the main export calls
  go at the bottom of the same file, or a sibling file — not mixed in
  above the export a reader actually came for.
- A folder earns a `src/` split (`components/`, `hooks/`, `utils/`) once
  it's genuinely grown into several concerns worth naming separately — a
  widget like `LocalCode` (its own client, event reducer, multiple hooks,
  sub-components) is the shape that justifies it. A typical widget never
  needs one; don't default to it.

Barrels (`index.ts`): use one where a folder's contents are *always*
consumed together as a unit — that's an import contract, not decoration
(`src/wigl/hooks/index.ts`). Don't add one just to shorten
`import { X } from './X/X'` into `import { X } from './X'` for a handful of
independent components; a barrel over many unrelated exports costs
tree-shaking and adds a file to keep in sync, for a problem a multi-segment
path already solves on its own.

## Don't future-proof past the second real use

Same instinct as "promote to shared only on the second real use", applied
inside a single widget too: don't generalize a module for a use case that
doesn't exist yet. A single-caller module built like a small framework —
its own types, its own lifecycle, config for variations nothing asks for —
is worse than the duplication it was meant to prevent, since it adds a
layer of indirection with nothing on the other end to justify it. Some
headroom is fine when a second use is genuinely expected soon; a whole
abstraction for a maybe isn't. If a module already reads like its own
sub-project but has exactly one caller, that's the sign to inline it back
down — not to go find a second caller to justify keeping it.

## Naming: "widget", not "plugin"

A widget's folder name, id, storage-key prefix, and any code or comment
describing *the thing itself* say **widget**. Reserve **plugin** for the
loading/build *mechanism* (`docs/plugins.md`: `src/wigl/plugins/`,
`plugin:build`/`plugin:install`, `wigl.permissions` in `package.json`) —
the machinery a widget happens to be built and shipped through, not what
it's called. (Existing code that still says "plugin" for the thing itself
is a known, tracked inconsistency — see `backlog.md` — not something this
rule expects you to go sweep the repo for.)
