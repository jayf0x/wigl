# Code-shape rules

Short and deliberately so — these are already how this codebase is written,
just not written down. Don't pad this file; add a rule here only once it's
been violated or a new agent needed it stated explicitly.

## Functional core, imperative shell

Logic that can be a pure function should be one. Components, hooks, and
Tauri commands stay thin glue around it — call the logic, hold state,
render. This already shows up as: `src/wigl/grid.ts` (pure tiling math, no
React), `use<Name>.ts` hooks owning the fetch/poll cycle so `index.tsx`
only renders, `src-tauri/src/lib.rs` commands staying thin wrappers around
whatever they invoke.

Why: pure logic is trivially testable and movable later without dragging a
component or an IPC boundary along with it. Keep new logic there by
default; only inline it in a component/hook when it's genuinely one-line
glue.
