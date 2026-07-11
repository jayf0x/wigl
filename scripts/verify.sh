#!/bin/sh
# Full verify loop: build the debug .app, relaunch it fresh (open alone would
# just focus a stale running instance), then check windows exist and the log
# is clean. See docs/debugging.md.
set -e
cd "$(dirname "$0")/.."

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
