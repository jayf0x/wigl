# Backlog

From the 2026-07-11 repo assessment. Ordered by priority within each section. Product ideas live in `docs/future-ideas.md`; this file is defects, decisions, and known ceilings.

## P1 — bugs

- [ ] **`useStorage` stale-poll revert** — the `lastJson` guard in [src/wigl/storage.ts:54](src/wigl/storage.ts) doesn't cover the case its comment claims: a poll `SELECT` issued *before* a local write but resolving *after* it sees old JSON ≠ `lastJson.current` and reverts the fresh write for up to 3 s. Fix: monotonic write counter (drop poll results issued before the last local write), or re-read after write.
- [ ] **`useStorage` write reordering** — `set()` writes are fire-and-forget `sqlite3` spawns; two rapid calls can commit in reverse order. Fix: chain writes per key on a promise queue (a few lines in `storage.ts`).

## P2 — decisions to make, then small fixes

- [ ] **Capabilities posture** — `{ "name": "sh", "args": true }` in `src-tauri/capabilities/default.json` grants arbitrary execution, so every other entry (`open`, `code`, `github`, `sqlite3`) is decorative ceremony that still causes "forgot to register the binary → silent no-op" failures. Decide: (a) accept local-trusted, collapse to `sh` + `sqlite3` and route everything through them — recommended; (b) make it a real boundary (drop `args: true`, per-binary arg policies) — real ongoing cost, fights the shell-out rule. Auto-generating entries at build time is magic on top of theater; skip.
- [ ] **Widget contract validation** — a typo'd `windowConfig` export name or a missing default export fails silently (blank window / default size). Minimum: spawner warns on missing `default` and on unrecognized exports. Better long-term shape: fold config into the default export (`export default widget(Component, { width: 200 })`) so there's one export and typos are type errors — matches the original spec's `Widget({ widget: Todo })` shape. ~10 lines in `App.tsx` + `src/wigl/types.ts`.
- [ ] **Error boundary per widget window** — original spec lists error boundaries as a runtime responsibility; today a render throw = silent white window, invisible to `verify.sh`. ~15 lines around `<Widget />` in `App.tsx`, render a visible "widget crashed" panel and `console.error` a greppable marker.
- [ ] **Share the CLI↔widget contract** — `scripts/calendar.ts` hand-duplicates the `CalendarEvent` type, the kv key, the DB path, and the table schema. It runs under bun and can import the type + key from `src/widgets/calendar/calendar.utils.ts` directly. Do that; the JSON shape (not just the key) is the real contract.
- [ ] **Storage key namespace convention** — flat global keyspace (`repos_sort_by`, `calendar_events`), collision-by-convention. Document "prefix keys with the widget folder name" in `docs/widgets.md` (auto-prefixing by window label would break the CLI contract; don't).

## P3 — known ceilings, act on trigger only

- [ ] **Poll-based storage sync** — every key in every window spawns a `sqlite3` process every 3 s. Trigger: visible flicker, or ~6+ widgets. Fix shape: broadcast a Tauri event (`emit`/`listen`, already in `core:default`) on write so windows sync instantly; keep a slow poll only for external CLI writers.
- [ ] **Every window parses the whole bundle** — `import.meta.glob(..., { eager: true })` means each WebView evaluates all widgets' code + deps. Trigger: startup lag or memory pressure at ~10+ widgets. Fix shape: eager glob for `windowConfig` only, lazy glob for components, each window awaits just its own.
- [ ] **One WebView per widget memory floor** — deliberate, correct trade-off; each realm costs tens of MB regardless of widget size. Trigger: measure at ~6–8 widgets before adding more.
- [ ] **Auto-offset spawn positions march off-screen** — the `40 + i * 300` fallback in `App.tsx` exits a 13" display around widget #5. Trigger: it happens. Fix: grid-wrap the fallback; explicit `windowConfig.x/y` stays manual.
- [ ] **Drag math across monitors** — `src/wigl/drag.ts` snapshots `currentMonitor()` at mousedown, so the proportional math uses the origin monitor after crossing; `setPosition` calls are unthrottled fire-and-forget IPC. Trigger: multi-display work actually starts (see `docs/future-ideas.md`).
- [ ] **`parseLine` delimiter** — repos scan splits on `|`; a folder named `foo|bar` shifts fields ([src/widgets/repos/useReposWidget.ts:48](src/widgets/repos/useReposWidget.ts)). Trigger: never, realistically. Fix if touched anyway: `\x1f` delimiter.
- [ ] **Spawner re-runs on `main` reload (dev only)** — module-level `spawned` flag doesn't survive a full reload of the hidden bootstrap window; respawn attempts error into an invisible console. Trigger: it confuses someone during dev. Fix: check `WebviewWindow.getByLabel` first.

## P4 — hygiene

- [ ] **README.md is still the stock Tauri template** — say what wigl is in three sentences, point at `AGENTS.md`/`docs/`.
- [ ] **Dependency placement** — build-only tools split across `dependencies`/`devDependencies` (`tailwindcss` + `@tailwindcss/vite` in deps, `vite` in dev). `shadcn` in `dependencies` is *correct* (App.css imports `shadcn/tailwind.css`) but will look wrong to every reviewer — add a comment or a line in docs.
- [ ] **No lint/format config** — codebase is consistent by discipline only; with agents doing most edits that drifts. A prettier config costs nothing; eslint is optional at this size. Decide deliberately either way.
- [ ] **`csp: null` + shell-derived strings** — fine while React escapes everything; add a hard rule to `AGENTS.md` forbidding `dangerouslySetInnerHTML` in widgets so it stays fine. *(done — rule added)*
- [ ] **`verify.sh` can't see JS console errors** — the spawn-failure message in `App.tsx` goes to a hidden window's console, never the unified log; `winlist.swift` window count is the real check. Either accept that (document it) or log spawn failures somewhere `log show` sees.
- [ ] **Hardcoded VS Code path** in capabilities breaks for Insiders/homebrew installs; `openInEditor`'s fallback degrades gracefully. Works-on-this-machine marker, fix if it ever bites someone else.

## Decided / won't fix

- **`.idea/` stays gitignored with docs referencing it** — it's the owner's local backup/history folder; the references are deliberate breadcrumbs, not a clone contract. Docs must stand alone without it (that's what the 2026-07-11 doc rewrite enforces).
- **Whole-blob last-writer-wins storage** — fine for single-user widget data; upgrade path (per-key table, row writes) documented in `docs/widgets.md`.
- **Verified non-issues**: key sanitization in `useStorage`; `?? 40 + i * 300` precedence; `relativeTime` timer ref-counting; shell-out-over-Rust; build-time glob discovery. Don't re-litigate.
