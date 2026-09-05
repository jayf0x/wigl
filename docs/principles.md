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
(`src/wigl/widget.tsx`). A folder with one file in it is a sign the split
happened too early.

Same rule inside a widget's own folder: once it has **2+** `use*.ts` hooks,
they get their own `hooks/`; once it has **2+** process-management/API-
client files talking to the same backing service, they get their own
`server/` (both group by kind, mirroring `src/wigl/hooks`/`utils`). A
widget with exactly one hook or one server file keeps it flat at the top
level — same "one file, too early" signal as above.

`src/wigl/Desktop.tsx` outgrew the "single-file concern" case above by line
count and coupling, not by this rule — it's `Desktop/` now (a composing
shell plus one hook per gesture/concern: drag, resize, cross-monitor sync,
the anchor field, the persisted layout, the right-click menu). That's a
different trigger than "2+ files of one kind": a single component whose
own body has grown several genuinely separate responsibilities. See the
80/20 rule below for when a file (not a whole widget folder) has reached
that point.

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

This is the one rule in this file a machine can decide, so it's checked
rather than trusted: `bun run check:style` (`scripts/check-style.ts`) fails on
any `function` declaration under `src/`, `scripts/`, or `wigl-widgets/`.
`src/components/ui/` is exempt — `bunx shadcn add` generates `export function`
and will keep doing so. Everything else in this file is judgment and stays
prose; don't try to lint it.

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

## No raw `<button>` — adopt the shared `Button`

`@/components/ui/button`'s `Button` (variants default/outline/secondary/
ghost/destructive/link, sizes default/xs/sm/lg/icon/icon-xs/icon-sm/icon-lg)
is already host-module-registered (`src/wigl/plugins/host-modules.ts`), so
every widget can import it exactly like `calendar/Sidebar.tsx` does — this
isn't a "build something new" ask, it's picking up what's already there.
Write a new interactive control as `<Button variant="..." size="...">`, not
a bare `<button className="...">` reimplementing focus/hover/disabled
styling that variant already has. Need a look the existing variants don't
cover? Add a variant to `Button` itself (a second real use — see below) or
extend one via `className` (it merges through `cn()`/`twMerge`, so a later
class in the string wins over the variant's own conflicting one) — never
stand up a parallel button component.

This isn't absolute: a control that isn't actually button-shaped (a 16px
color-swatch chip, a multi-row card, a bare tag a CSS selector already
styles for a whole repeated list) can fight the shared component's baked-in
sizing/padding more than it helps. A genuine case like that stays a raw
`<button>` with a one-line comment explaining why, plus a
`// check-style:allow-raw-button` marker (`scripts/check-style.ts` enforces
this the same mechanical way it enforces `export const` over `export
function` — see that script's own doc comment).

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
loading/build *mechanism* itself (`docs/widgets.md`'s "Build, install, and the plugin mechanism": `src/wigl/plugins/`,
`scripts/widget.ts`, `wigl.permissions` in `package.json`) — the machinery a
widget happens to be built and shipped through, not what it's called. The
CLI commands (`widget:build`/`widget:install`/`widget:check`/...) say
**widget** too — they build and install a widget, even though the mechanism
underneath keeps the "plugin" name.
