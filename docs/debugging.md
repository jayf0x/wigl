# Debugging, gotchas, and how to verify changes

## You often can't take a screenshot

This window is `alwaysOnBottom` + `skipTaskbar` + undecorated, running in environments that may be headless/sandboxed agent shells with no real interactive display. Screenshots are frequently unreliable here (can capture unrelated screensaver/lock-screen content instead of the app) and mouse-drag gestures can't be scripted without accessibility permissions this environment usually doesn't have. Default to verifying through logs and process state instead:

- **Is it running / did it crash**: `ps aux | grep "[w]igl"` (bracket trick avoids matching the grep process itself).
- **Runtime errors / permission denials**: `log show --predicate 'process == "wigl"' --last 2m | grep -i "denied\|not allowed\|error\|panic"`. IPC permission failures show up here, not as a JS exception you'd see in a browser devtools console.
- **Is the frontend bundle actually fresh**: `grep -o "<marker-string-unique-to-current-component>" dist/assets/index-*.js`. See "Stale build" below for why this matters.
- **Test shell-command logic standalone, before wiring it into the app**: run the exact script string against the real filesystem in a plain `sh -c '...'` in the terminal first. This catches logic bugs in seconds instead of round-tripping through a full Tauri rebuild.

## Stale frontend bundle after editing during a build

`bun run tauri build` (and `dev`) runs the Vite frontend build once at the start, then compiles Rust, which embeds whatever `dist/` contained at that point. If you edit `src/*.tsx` *while* a build is still compiling Rust, the running build already snapshotted the old frontend — your edits won't appear in that binary. Symptom: the app runs, no errors, but shows old/wrong content.

Fix: after any frontend edit, do a full `bun run build` (regenerates `dist/`) before rebuilding Rust, and confirm freshness with the `grep` trick above before assuming a runtime bug when it might just be a stale bundle. If merely re-running `cargo build` (not `bun run tauri build`) after a frontend edit, note that cargo may not detect that `dist/` changed and skip re-embedding — force it by removing the stale binary/build cache (`rm -rf src-tauri/target/debug/build/wigl-* src-tauri/target/debug/wigl`) before rebuilding, if you're not sure. Note `wigl` here is the app binary name (from `Cargo.toml`), not a widget — the currently-mounted widget is `ReposWidget`.

## Transparent windows need the private API

`"transparent": true` in `tauri.conf.json` silently does nothing on macOS (with a warning printed to stdout, not thrown) unless:
1. `"macOSPrivateApi": true` is also set under `app` in `tauri.conf.json`, **and**
2. `features = ["macos-private-api"]` is added to the `tauri` dependency in `src-tauri/Cargo.toml`.

Both are required; either alone fails (the second one fails the Cargo build outright with a clear "does not match the allowlist" error, so that half is hard to miss — the first half fails silently at runtime).

## "It does nothing" often means a missing permission

Tauri's `core:default` capability is narrower than it looks — window position read/write, for example, is *not* included and must be added explicitly to `src-tauri/capabilities/default.json` (see `docs/architecture.md`'s permissions section). A missing permission on plugin APIs (window, shell, fs, ...) generally does not throw a catchable JS error from `await` — check the unified log (`log show`, above) for "not allowed"/"denied" rather than assuming your JS logic is wrong.

New shell binary calls need a matching `name`/`cmd` entry under `shell:allow-execute` in the same capabilities file — forgetting this is the most common way a new shell-backed feature "just doesn't work."

## DMG bundling can fail in sandboxed/headless environments

`bun run tauri build` without flags tries to bundle a `.dmg` via `hdiutil`, which can fail in sandboxed CI-like shells even though the actual app compiled fine. This is not a code bug. Use `bun run tauri build --debug --bundles app` to build just the `.app` bundle and skip DMG creation when verifying changes in such an environment.

## Bundle identifier

Don't end `identifier` in `tauri.conf.json` with `.app` (e.g. `com.foo.app`) — Tauri warns because it collides with the macOS `.app` bundle extension. Use something like `com.foo.desktop` instead.
