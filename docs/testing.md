# Testing

Everything test-related lives under `./tests`. This doc is the practical
guide — layout, how to write one, how to mock. `AGENTS.md`'s "Testing"
section has the policy (what's core, the backlog-instead-of-inline
workflow) — read that first if you haven't.

## Layout

- Flat files directly in `tests/` — pure-logic and DOM-level tests for
  `src/wigl` (core), one file per concern, no subfolder until there's
  actually enough of them to need one (`docs/principles.md`'s "80/20 file"
  rule applies to this folder too — don't pre-create `unit/`/`dom/`
  subfolders for a handful of files).
  - `register-dom.ts` — happy-dom, preloaded via `bunfig.toml` into every
    `bun test` run.
  - `mock-storage.ts` — the storage/event mock (see "Mocking" below).
  - `*.demo.test.ts` — proves one tier of infra actually works end to end;
    not real regression coverage for anything. Replace/delete once a real
    test using that tier exists.
  - `grid-math.test.ts` — real coverage for `src/wigl/grid/math.ts`.
- `e2e/` — the widget CLI subprocess suite: build/install/check against a
  real temp filesystem, real `tsc`, real `Bun.build`. Slower (low
  single-digit seconds) but not dangerous — no real cursor, no live
  display needed. See its own `README.md`.
- `manual/` — anything that drives a **real OS cursor** or needs a live
  display (macOS `cliclick`, the Linux X11/XTest harness, perf probes).
  Python/bash/AppleScript/whatever fits — no "must be TypeScript" rule
  here. Never wired into any `bun run test*` script and never should be —
  read its own `README.md`'s safety rules before running anything in it.
- `backlog.md` — pending automated coverage for `src/wigl` (core), queued
  rather than written on the spot when a bug's fixed. See `AGENTS.md`.

## Writing a test

1. **Pure logic** (grid math, a coordinate correction, a permission check)
   — a flat `<name>.test.ts` in `tests/`, importing straight from
   `src/wigl/...`. No DOM, no mocks, fastest — most coverage should be
   this. `tests/grid-math.test.ts` is the reference.
2. **DOM/component-level** (`Desktop.tsx`-level drag/pointer logic) — same
   flat file, but you get a real `document`/`window` for free (happy-dom,
   preloaded — see `tests/register-dom.ts`). happy-dom's `PointerEvent`
   constructor accepts `screenX`/`screenY` directly (confirmed live — see
   `tests/dom.demo.test.ts`), so a cross-monitor drag is exercisable with a
   synthetic event, no real cursor needed.
3. **Anything using `useStorage`/`useQuery`** — see "Mocking" below before
   writing one; don't reach for a real `sqlite3` or Tauri runtime.

Naming: match the module under test (`grid-math.test.ts` for
`src/wigl/grid/math.ts`), not the bug that prompted it — a bug's backlog
entry gets deleted once it's fixed (`backlog.md`'s own rule), so a name or
comment that only makes sense by cross-referencing a ticket ID goes stale
the moment that entry is gone. Reference a **commit hash** instead when you
need to point at the "why" — git history doesn't get pruned.

## Mocking

`tests/mock-storage.ts` swaps `src/wigl/storage/client` (the `sql`/
`sqlLiteral` pair `useStorage`/`useQuery` call through) and
`@tauri-apps/api/event` (`emit`/`listen`) for an in-memory kv store, via
`bun:test`'s `mock.module`. Use it for anything built on those hooks:

```ts
import { mockStorage } from "./mock-storage";
const storage = mockStorage();
const { useStorage } = await import("../src/wigl/hooks/useStorage");
// render, interact, then:
storage.kv.get("some_key"); // inspect what got written
```

`mock.module` only affects modules resolved *after* it runs — always call
`mockStorage()` before the dynamic `import()` of the hook under test, never
a static top-level import of it. `mock.module` is also process-global and
Bun doesn't auto-restore it between test files, so call `storage.restore()`
in an `afterAll` if a later test in the same run needs the real modules
back. `tests/mock-storage.demo.test.ts` is a working example.

Nothing else needs a mock today (the plugin registry's permission gating
and grid math are pure functions — call them directly). If a future test
needs to mock a different host module (`@tauri-apps/plugin-shell`, say),
follow the same `mock.module` pattern rather than building a generic mocking
framework for a need that doesn't exist yet.

## Running

- `bun run test` — everything safe: every flat file in `tests/`,
  `tests/e2e`, and every widget's own `wigl-widgets/<name>/tests/`.
- `bun run test:widgets` — only widget-local tests.
- `bun run test:e2e` — only the widget CLI e2e suite, isolated (useful when
  iterating on `scripts/widget.ts` without waiting on everything else).
- Anything under `manual/` — run directly
  (`python3 tests/manual/x11-report.py`,
  `python3 tests/manual/cross-monitor-drag-probe.py ...`), never through a
  `bun run` script. That's deliberate, not an oversight — see `AGENTS.md`.
