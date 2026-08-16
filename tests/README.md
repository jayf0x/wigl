# tests

Automated + manual test surface for wigl. See root `AGENTS.md`'s "Testing"
section for the philosophy (what's core vs. not, why a bug fix appends to
`backlog.md` here instead of writing the test inline) — this file is the
"how", not the "why".

## Layout

- Flat files directly in `tests/` — pure-logic and DOM-level tests for
  `src/wigl` (core), one file per concern, no subfolder until there's
  actually enough of them to need one (`docs/principles.md`'s "80/20 file"
  rule applies to this folder too — don't pre-create `unit/`/`dom/`
  subfolders for a handful of files).
  - `register-dom.ts` — happy-dom, preloaded via `bunfig.toml` into every
    `bun test` run, so any file here can mount a component or dispatch a
    synthetic event without a browser or Tauri runtime.
  - `mock-storage.ts` — swaps `src/wigl/storage/client` +
    `@tauri-apps/api/event` for an in-memory kv store (via `bun:test`'s
    `mock.module`), so `useStorage`/`useQuery` — and anything built on them
    — are testable with no real `sqlite3` binary or Tauri IPC.
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

## Running

- `bun run test` — everything safe: every flat file here, `tests/e2e`, and
  every widget's own `wigl-widgets/<name>/tests/`.
- `bun run test:widgets` — only widget-local tests.
- `bun run test:e2e` — only the widget CLI e2e suite, isolated (useful when
  iterating on `scripts/widget.ts` without waiting on everything else).
- Anything under `manual/` — run directly
  (`python3 tests/manual/x11-report.py`, `./tests/manual/b8-drag-probe.sh ...`),
  never through a `bun run` script. That's deliberate, not an oversight.
