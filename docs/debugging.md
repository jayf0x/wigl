# Debugging, gotchas, and how to verify changes

Most of this file is macOS-specific tooling (`log show`, `swift scripts/winlist.swift`, DMG bundling) because that flow has the most moving parts to go wrong (transparency, click-through, per-monitor windows). See "Verifying on Linux" near the end for the windowed flow's much shorter checklist — it's a normal window, so most of what follows below doesn't apply to it.

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

## Webview console errors are invisible to `log show` / `bun run verify`

Neither macOS's `log show` nor `verify.sh`'s captured stdout/stderr sees anything printed to a webview's own devtools console — that's a separate stream Rust never touches. A React crash (including a minified "Minified React error #NNN" message) can leave a monitor window blank with `bun run verify` still reporting "log errors: none", because verify only checks the native process's output, not the webview's console.

Two things narrow this down:
- `src/main.tsx` installs `window.onerror`/`unhandledrejection` handlers that `console.error` with a `[wigl]` prefix, and `AppErrorBoundary` (`src/App.tsx`, one level above `<Desktop>`) plus each widget's own `WidgetErrorBoundary` (`Desktop.tsx`) turn a render crash into a visible on-screen message instead of a blank window — check what's on screen for a "wigl crashed: ..." / "widget "..." crashed" line before assuming the window has no error to report.
- To get the *un-minified* React error message, run against a dev bundle instead of a production one: `bun run tauri dev` (uses `beforeDevCommand: bun run dev`, an unminified Vite dev build) rather than `bun run tauri build`/`verify` (uses `bun run build`, minified). Minified React errors are only a numbered pointer to https://react.dev/errors/NNN — the dev bundle gives the actual message and component stack directly.

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

## Verifying on Linux

Building this app's Rust side on Linux needs the usual Tauri prerequisites (a Rust toolchain, `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `build-essential`, `pkg-config`) — none of that is macOS-specific to this repo, it's Tauri's standard Linux build dependency list.

Which of the two window flows you get (`docs/architecture.md`'s overlay vs. windowed) depends on the session, not the code: `echo $XDG_SESSION_TYPE` — `wayland` gets the windowed flow (the common case on stock Ubuntu/GNOME), `x11` gets the same desktop-overlay flow macOS uses. Force either one with `WIGL_MODE=windowed` / `WIGL_MODE=overlay` when you need to test the other deliberately.

Checking the app is actually up, without a reliable screenshot or window-listing tool (Wayland has no cross-desktop equivalent of macOS's `CGWindowListCopyWindowInfo` trick, and X11's `wmctrl`/`xdotool` aren't installed by default on Ubuntu) — `bun run verify` does this for you (see `scripts/verify.sh`'s Linux branch): launches the built debug binary directly (`src-tauri/target/debug/wigl`, redirecting stdout/stderr to a temp log since there's no `log show` equivalent to query after the fact), then checks `pgrep -x wigl` for liveness and greps that log for `denied`/`error`/`panic`/`failed`. In windowed mode this is close to sufficient on its own — it's a normal window, so if the process is alive and the log is clean, the window is almost certainly showing (unlike the overlay flow, where a live process with zero visible windows is a real failure mode worth extra checking).

`sqlite3` isn't guaranteed present on a fresh Ubuntu install the way it is on macOS — `useStorage`-backed widgets (see `docs/widgets.md`) will log read/write errors, not crash, until it's installed (`apt install sqlite3`, then relaunch — no other fix needed). If a widget looks stuck on its initial/empty state on Linux, check for that log line before assuming a code bug.

**A bare `cargo build` on Linux tries to load the Vite dev server, not the built bundle.** Whether Tauri embeds `frontendDist` or proxies to `devUrl` (`http://localhost:1420`) is decided by the `custom-protocol` cargo feature on the `tauri` crate — `bun run tauri build`/`tauri dev` (what `verify.sh` and `qa.sh`'s Darwin branch use) always sets it under the hood, but a plain `cargo build` doesn't opt in on its own. Without it, the debug binary tries to fetch `localhost:1420` and — since nothing here runs a dev server — the app window shows "Could not connect to localhost: Connection refused" even though the build itself succeeded. `scripts/qa.sh`'s Linux branch builds with `cargo build --features tauri/custom-protocol` for exactly this reason; if you ever shell out to `cargo build` directly for a quick Linux binary, add that flag too.

Every launch prints two diagnostic lines to stderr — `[wigl] mode: windowed (WIGL_MODE=..., XDG_SESSION_TYPE=..., WAYLAND_DISPLAY=..., WEBKIT_DISABLE_DMABUF_RENDERER=...)` and `[wigl] page load: Started/Finished <url>` (`src-tauri/src/lib.rs`'s `setup()`) — check these first whenever the window that comes up doesn't match what you expected, or nothing comes up at all. If `page load: Finished` never prints, the break is in webview/content loading itself (asset path, `frontendDist`, GPU-init blocking load), not in window show/mapping.

### Process runs, no error, but no window ever appears

The windowed flow's `WebviewWindowBuilder` calls `.visible(true)`/`.show()` directly in Rust right after `build()` (`lib.rs`) rather than waiting on the webview's JS to mount and call `getCurrentWindow().show()` over IPC — a real bug that used to live here: on some WebKitGTK/Wayland combinations that JS round-trip never completed, leaving the window created but permanently unmapped (`xwininfo` showed `Map State: IsUnMapped`, `10x10` placeholder geometry) while the process stayed alive with a clean log — every symptom of "no window" with nothing to grep for. If you hit this again despite the direct-show fix, `GDK_BACKEND=x11 <binary>` plus `xwininfo -root -tree -display :0 | grep -i wigl` (then `xwininfo -id <id>` on the match) is how to check the window's actual map state and geometry directly, since Wayland-native surfaces are otherwise invisible to X11 tooling.

If the window now maps/shows but stays blank/white, that's a different failure mode: WebKitGTK's DMA-BUF renderer (the default since 2.42) can silently fail to present anything on certain GPU/driver combinations, most commonly hybrid-GPU laptops, dual-discrete-GPU desktops, and **external-display/docking-station setups** under Wayland. `lib.rs`'s `run()` sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` by default on Linux to work around exactly this (visible in the mode line above); it only does so if you haven't already set that env var yourself, so `WEBKIT_DISABLE_DMABUF_RENDERER= bun run qa` (forcing it unset) is how to confirm whether that's actually the cause on a machine where the workaround still isn't enough. `WEBKIT_DISABLE_COMPOSITING_MODE=1` is a blunter fallback (disables WebKit's compositor entirely) if DMA-BUF alone doesn't resolve it.

If the window is still invisible with that workaround in place, next things to try, in order: `WEBKIT_DISABLE_COMPOSITING_MODE=1` (a blunter, older fallback that disables WebKit's compositor entirely), unplugging the external display to test on the laptop's own panel (isolates whether it's specifically the external-display/docking path), and `journalctl --user -b 0 | grep -i webkit` for a GPU/driver-level crash the app's own stderr wouldn't surface.
