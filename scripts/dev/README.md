# scripts/dev

Reusable, rerunnable scripts (bash/python/AppleScript/whatever fits) for
manually exercising a specific flow — not automated tests, not CI. The point
is a lightweight, predictable way to QA something ("does drag still work
across monitors", "does the composer still stream a reply") without writing
and maintaining a full test suite for it.

- One script per flow, named for what it checks (`check-drag.sh`, not `test1.sh`).
- A script that only makes sense for one widget lives in that widget's own
  folder instead (see root `AGENTS.md`'s script-placement rule) — this
  folder is for repo-wide flows.
- Delete a script once the flow it checks no longer exists or is covered by
  a real automated test instead. This folder isn't an archive.
