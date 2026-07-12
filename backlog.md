# Backlog

Open items only, ordered by priority within each section. Product ideas live in `docs/future-ideas.md`; this file is defects, open decisions, and known ceilings.

Rules for keeping this file real:

- Every entry here must be actionable: a problem someone could pick up and fix right now. If it's not actionable, it doesn't belong here.
- When an item is fixed, delete it. Don't check it off and leave it, don't move it to a "done" or "changelog" list — git history is the changelog.
- When a decision is made and closed with no remaining follow-up work, delete it too. Don't keep a "Decided / won't fix" graveyard — a closed decision with nothing left to do is not a backlog item.
- No dates, no "as of this session", no "swept on", no references to when something was added or by whom. This file describes the current state of the codebase, not its history.
- If a fix is genuinely speculative (no concrete trigger), say so plainly and give the trigger condition — don't leave vague "might be nice" entries.
- Prefer deleting or rewriting a stale entry over leaving it half-true when the code has moved past it.

## P3 — known ceilings, act on trigger only

- [ ] **Poll-based storage sync** — every key in every window still spawns a `sqlite3` process every 3 s to detect *external* changes (another widget, a CLI script). `widget_layout` now also broadcasts over `emit`/`listen` (`wigl-layout` in [Desktop.tsx](src/wigl/Desktop.tsx)) so cross-monitor drags don't wait on the poll, but that's one key, not a general fix — every other key (`calendar_events`, `repos_sort_by`, ...) still only updates on the next poll tick. Trigger: visible flicker, ~6+ widgets, or another key needing the same near-instant cross-window sync.
- [ ] **Every screen window parses the whole bundle** — `import.meta.glob(..., { eager: true })` in `App.tsx` means each per-monitor WebView evaluates every widget's code + deps, even widgets it doesn't render. Trigger: startup lag or memory pressure at ~10+ widgets. Fix shape: eager glob for `gridConfig` only, lazy glob for components, each monitor awaits just the widgets assigned to it.
- [ ] **Grid reflow only compacts vertically** — `reflow()` in [grid.ts](src/wigl/grid.ts) pushes collisions straight down and gravity-compacts upward, with no horizontal repacking. A monitor that's had a lot of widgets dragged around can end up as one tall column with wasted width beside it, even though a compact arrangement exists. Not wrong, just not optimal. Trigger: this is visibly annoying in daily use — the fix (occupy the first horizontal gap, not just push down) is a moderate rewrite of `reflow`, not a small patch, so don't do it speculatively.
- [ ] **Monitor add/remove needs an app relaunch** — `screen-<i>` windows are created once in Rust's `setup()` ([lib.rs](src-tauri/src/lib.rs)) from `available_monitors()` at launch. Plugging in or removing a display doesn't add/destroy a window or migrate its widgets. Trigger: this becomes the normal complaint once someone actually docks/undocks a laptop with wigl running. Fix shape: listen for a monitor-change signal (polling `available_monitors()` is the only cross-platform option Tauri exposes today) and reconcile: spawn new screen windows, and for removed monitors, reassign their widgets' `m` to monitor 0 rather than losing them.
- [ ] **Escape doesn't cancel a drag** — deliberate gap, not an oversight: `screen-*` windows are `alwaysOnBottom` and rarely become key, so a `keydown` listener isn't a reliable place to catch Escape. Trigger: revisit if/when there's a reason one of these windows does become key (e.g. a command palette), since that would give you a reliable focus target to hang the listener off.
- [ ] **`parseLine` delimiter** — repos scan splits on `|`; a folder named `foo|bar` shifts fields ([src/widgets/repos/useReposWidget.ts:48](src/widgets/repos/useReposWidget.ts)). Trigger: never, realistically. Fix if touched anyway: `\x1f` delimiter.

## P4 — hygiene

- [ ] **Hardcoded VS Code path** in `src/widgets/repos/useReposWidget.ts` (`VSCODE_CLI`) breaks for Insiders/homebrew installs; `openInEditor`'s fallback degrades gracefully. Works-on-this-machine marker, fix if it ever bites someone else.
- [ ] **No repo-wide Prettier pass yet** — `.prettierrc.json`/`bun run format` exist now, but running `--write` across the whole tree is still a one-time, deliberate, largeish diff nobody's pulled the trigger on. Do it in its own commit whenever someone's willing to review a pure-formatting diff, not bundled with a feature change.
