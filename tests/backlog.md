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

_Empty — nothing queued right now._
