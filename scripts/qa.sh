#!/bin/sh
# Fast build+launch loop for manual QA — not the full checks `bun run verify`
# does (no log-grepping, no window-count check), just "build fresh, launch,
# look at it" as quickly as possible. Skips packaging (.deb/.dmg) since QA
# only needs the runnable binary. See docs/architecture.md's overlay vs.
# windowed split for what each mode looks like.
#
#   bun run qa       # auto-detect: overlay on macOS/X11, windowed on Wayland
#   bun run qa:app    # force windowed mode everywhere (WIGL_MODE=windowed)
#
# Runs the app in the foreground (not backgrounded) — Ctrl+C in this same
# terminal kills it directly, no separate pkill needed for that case. Each
# run still kills any instance left over from a previous one first.
set -e
cd "$(dirname "$0")/.."

# A rustup install (e.g. the snap package) doesn't always put its shims on
# PATH ahead of a distro-packaged `cargo` — if that older one wins, cargo
# errors on this project's lockfile format. Prefer whatever rustup itself
# resolves, if rustup is present, over plain PATH lookup.
if command -v rustup >/dev/null 2>&1; then
  RUSTUP_CARGO="$(rustup which cargo 2>/dev/null || true)"
  if [ -n "$RUSTUP_CARGO" ]; then
    export PATH="$(dirname "$RUSTUP_CARGO"):$PATH"
  fi
fi

WINDOWED=0
for arg in "$@"; do
  [ "$arg" = "--windowed" ] && WINDOWED=1
done

# Kill any instance from a previous `qa`/`qa:app` run (or a stray `tauri
# dev`) before rebuilding — otherwise each run stacks a new process on top
# of the last one instead of replacing it.
pkill -x wigl 2>/dev/null && sleep 1 || true

echo "[qa] building frontend..."
bun run build >/dev/null

OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
  echo "[qa] building macOS .app..."
  bun run tauri build --debug --bundles app
  BIN="src-tauri/target/debug/bundle/macos/wigl.app/Contents/MacOS/wigl"
else
  echo "[qa] building Linux binary..."
  (cd src-tauri && cargo build)
  BIN="src-tauri/target/debug/wigl"
fi

# The build can take a while; a manual `bun run qa` fired again in the
# meantime, or `tauri dev` started separately, could have spawned another
# instance since the check above. Clear the deck right before launch too.
pkill -x wigl 2>/dev/null && sleep 1 || true

if [ "$WINDOWED" = "1" ]; then
  echo "[qa] launching in windowed mode (WIGL_MODE=windowed) — Ctrl+C to stop"
  export WIGL_MODE=windowed
else
  echo "[qa] launching (auto-detect: overlay on macOS/X11, windowed on Wayland) — Ctrl+C to stop"
fi
# exec, not `&`: replaces this script's process with the binary instead of
# backgrounding it, so the terminal's Ctrl+C reaches wigl directly (a
# backgrounded child doesn't get the foreground shell's SIGINT). Also prints
# its own [wigl] stderr straight to this terminal, e.g. "mode: windowed/
# overlay" on every launch — check that line first if the window that comes
# up doesn't match what you expected.
exec "$BIN"
