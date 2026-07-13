# Debugging, gotchas, and how to verify changes

## You often can't take a screenshot

This window is `alwaysOnBottom` + `skipTaskbar` + undecorated, running in environments that may be headless/sandboxed agent shells with no real interactive display. Screenshots are frequently unreliable here (can capture unrelated screensaver/lock-screen content instead of the app) and mouse-drag gestures can't be scripted without accessibility permissions this environment usually doesn't have. Default to verifying through logs and process state instead:

- **Is it running / did it crash**: `ps aux | grep "[w]igl"` (bracket trick avoids matching the grep process itself). All widget windows share one OS process — one line in `ps` output is expected even with multiple widgets mounted. To count/locate the actual windows, use the `CGWindowListCopyWindowInfo` swift trick in "Widget window doesn't appear" below.
- **Runtime errors / permission denials**: `log show --predicate 'process == "wigl"' --last 2m | grep -i "denied\|not allowed\|error\|panic"`. IPC permission failures show up here, not as a JS exception you'd see in a browser devtools console.
- **Is the frontend bundle actually fresh**: `grep -o "<marker-string-unique-to-current-component>" dist/assets/index-*.js`. See "Stale build" below for why this matters.
- **Test shell-command logic standalone, before wiring it into the app**: run the exact script string against the real filesystem in a plain `sh -c '...'` in the terminal first. This catches logic bugs in seconds instead of round-tripping through a full Tauri rebuild.

## Stale frontend bundle after editing during a build

`bun run tauri build` (and `dev`) runs the Vite frontend build once at the start, then compiles Rust, which embeds whatever `dist/` contained at that point. If you edit `src/*.tsx` *while* a build is still compiling Rust, the running build already snapshotted the old frontend — your edits won't appear in that binary. Symptom: the app runs, no errors, but shows old/wrong content.

Fix: after any frontend edit, do a full `bun run build` (regenerates `dist/`) before rebuilding Rust, and confirm freshness with the `grep` trick above before assuming a runtime bug when it might just be a stale bundle. If merely re-running `cargo build` (not `bun run tauri build`) after a frontend edit, note that cargo may not detect that `dist/` changed and skip re-embedding — force it by removing the stale binary/build cache (`rm -rf src-tauri/target/debug/build/wigl-* src-tauri/target/debug/wigl`) before rebuilding, if you're not sure. Note `wigl` here is the app binary name (from `Cargo.toml`), not a widget.

## Transparent windows need the private API

`"transparent": true` in `tauri.conf.json` silently does nothing on macOS (with a warning printed to stdout, not thrown) unless:
1. `"macOSPrivateApi": true` is also set under `app` in `tauri.conf.json`, **and**
2. `features = ["macos-private-api"]` is added to the `tauri` dependency in `src-tauri/Cargo.toml`.

Both are required; either alone fails (the second one fails the Cargo build outright with a clear "does not match the allowlist" error, so that half is hard to miss — the first half fails silently at runtime).

## Widget doesn't appear / isn't clickable

Widgets aren't windows (see `docs/architecture.md`) — they're grid items rendered by whichever monitor's `<Desktop>` owns them, so "the app runs but a widget is missing or dead" has its own checklist:

1. **Folder contract**: the widget must be `src/widgets/<name>/index.tsx` with a **default** export — a named-only export or a differently-named file silently won't match the `import.meta.glob` pattern (`src/App.tsx` logs `[wigl] widget "<id>" has no default export` when this happens). Check the folder name isn't `main` (reserved).
2. **A render crash is caught, but check for it**: each widget mounts inside its own error boundary (`WidgetErrorBoundary` in `Desktop.tsx`) — an uncaught throw shows as an inline "widget crashed" message in that grid cell (not a blank app) and logs `[wigl] widget "<id>" crashed` with the stack. Check devtools/`log show` for that line before assuming a layout bug.
3. **Looks unclickable / whole screen looks stuck**: this is almost always the click-through hit-testing, not the widget itself — `src-tauri/src/lib.rs`'s cursor poller toggles native click-through based on hit-rects each `<Desktop>` reports via `set_hit_rects`. A widget with a `NaN`/garbage position reports a hit-rect that never matches the cursor, so the whole window falls back to click-through everywhere (see "Renaming a `useStorage` shape..." below — this is the most common cause).
4. **Monitor-window permission denials**: check `log show` for denials on `core:window:allow-available-monitors` / `core:window:allow-show` (`capabilities/default.json`) — see `docs/architecture.md`'s permissions section.
5. **Relaunch, don't just look**: `open` on the `.app` focuses an already-running instance instead of launching your fresh build — `bun run kill` first, or just use `bun run verify` which handles it.

To verify monitor windows actually exist without a screenshot: `swift scripts/winlist.swift` (uses `CGWindowListCopyWindowInfo` — no Accessibility permission needed for bounds/count, only window *names* are gated). Trust bounds + count; the `onscreen` flag flip-flops with Space/display focus. `bun run verify` runs the whole build → relaunch → winlist → log-grep loop in one command. Note this only confirms the per-monitor `screen-<i>` windows exist — it can't tell you which widgets are rendered inside them.

## Renaming a `useStorage` shape doesn't migrate rows already on disk

`useStorage` (and anything that persists through it, e.g. `widget_layout`)
round-trips a JSON blob with no schema/version and no validation on read —
renaming or restructuring a field in code changes what *new* writes look
like, but any row written before that change keeps its old shape in
`~/Library/Application Support/wigl/wigl.db` forever, until something writes
that key again. Reading an old shape with new field names silently produces
`undefined`/`NaN` rather than an error, which then propagates: `NaN` in a
grid position collapses widget layout to one corner and breaks the Rust
click-through hit-testing (the whole window falls back to click-through
everywhere — looks exactly like the app being stuck/unresponsive, not like a
data bug). Symptom actually hit here: renaming `SavedPositions`'s `x`/`y` to
`col`/`row` left an existing `widget_layout` row with the old field names.

Check first: `sqlite3 ~/Library/Application\ Support/wigl/wigl.db "SELECT value FROM kv WHERE key='<key>'"`
— if the JSON shape doesn't match what the current code reads, that's the
bug, not your layout/rendering logic. Fix by rewriting that one row with
`UPDATE kv SET value = '...' WHERE key='<key>'` (this is dev-machine data,
not a versioned external contract, so a direct one-time edit is the right
fix — not a permanent legacy-shape fallback in app code). See `TODO.md`'s
on-load sanity pass for the actual prevention: validate a stored shape
before trusting it, fall back to a fresh default when it doesn't look right.

## "It does nothing" often means a missing permission

Tauri's `core:default` capability is narrower than it looks — window position read/write, for example, is *not* included and must be added explicitly to `src-tauri/capabilities/default.json` (see `docs/architecture.md`'s permissions section). A missing permission on plugin APIs (window, shell, fs, ...) generally does not throw a catchable JS error from `await` — check the unified log (`log show`, above) for "not allowed"/"denied" rather than assuming your JS logic is wrong.

`shell:allow-execute` only registers `sh` and `sqlite3` (see `docs/architecture.md`'s permissions section) — run new shell-backed features as `sh -c "..."` rather than adding a new binary's `name`/`cmd` entry.

## DMG bundling can fail in sandboxed/headless environments

`bun run tauri build` without flags tries to bundle a `.dmg` via `hdiutil`, which can fail in sandboxed CI-like shells even though the actual app compiled fine. This is not a code bug. Use `bun run tauri build --debug --bundles app` to build just the `.app` bundle and skip DMG creation when verifying changes in such an environment.

## Bundle identifier

Don't end `identifier` in `tauri.conf.json` with `.app` (e.g. `com.foo.app`) — Tauri warns because it collides with the macOS `.app` bundle extension. Use something like `com.foo.desktop` instead.
