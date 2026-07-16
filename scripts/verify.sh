#!/bin/sh
# Full verify loop: build the debug app, relaunch it fresh (open/exec alone
# would just focus a stale running instance), then check it's actually up
# and the log is clean. See docs/debugging.md. Branches on uname since the
# check-it's-alive step differs per platform (no shared cross-platform way
# to enumerate GUI windows, especially under Wayland — see that doc).
set -e
cd "$(dirname "$0")/.."

# A rustup install (e.g. the snap package) doesn't always put its shims on
# PATH ahead of a distro-packaged `cargo` — if that older one wins, the
# `bun run tauri build` below (which shells out to cargo internally) can
# fail on this project's lockfile format. Prefer whatever rustup itself
# resolves, if rustup is present, over plain PATH lookup.
if command -v rustup >/dev/null 2>&1; then
  RUSTUP_CARGO="$(rustup which cargo 2>/dev/null || true)"
  if [ -n "$RUSTUP_CARGO" ]; then
    export PATH="$(dirname "$RUSTUP_CARGO"):$PATH"
  fi
fi

if [ "$(uname -s)" = "Darwin" ]; then
  bun run tauri build --debug --bundles app

  pkill -x wigl 2>/dev/null || true
  sleep 1
  open src-tauri/target/debug/bundle/macos/wigl.app
  sleep 3

  echo "--- windows ---"
  swift scripts/winlist.swift
  echo "--- log errors (last 30s) ---"
  # exclude macOS system noise the WebView emits (Siri prefs, CFBundle chatter)
  log show --predicate 'process == "wigl"' --last 30s 2>/dev/null \
    | grep -i "denied\|not allowed\|error\|panic\|failed" \
    | grep -v "com.apple.siri\|AssistantServices\|CFBundle:resources" || echo "none"
else
  bun run tauri build --debug --bundles deb 2>&1 | tail -20 || true

  pkill -x wigl 2>/dev/null || true
  sleep 1
  LOG="/tmp/wigl-verify.log"
  # Wayland has no cross-desktop way to list a client's windows (same reason
  # the overlay flow falls back to windowed mode there, see lib.rs) — captured
  # stdout/stderr plus process liveness is the check instead of a window list.
  src-tauri/target/debug/wigl >"$LOG" 2>&1 &
  sleep 3

  echo "--- process ---"
  pgrep -x wigl >/dev/null && echo "wigl is running" || echo "wigl is NOT running"
  echo "--- log errors ---"
  grep -i "denied\|not allowed\|error\|panic\|failed" "$LOG" || echo "none"
fi
