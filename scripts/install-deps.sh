#!/bin/sh
# One-time system setup for building/running wigl from source. Only touches
# system packages (via apt/brew) and prints what's needed for Rust — never
# run automatically by `bun install`/`bun run dev` (see docs/architecture.md's
# storage note on keeping the app's own footprint minimal; this is a dev-
# machine setup step, not something the app depends on at runtime beyond the
# optional `sqlite3` CLI already covered in docs/widgets.md).
set -e

echo "[install-deps] OS: $(uname -s)"

if ! command -v rustc >/dev/null 2>&1 && ! command -v rustup >/dev/null 2>&1; then
  echo "[install-deps] No Rust toolchain found. Install one first: https://rustup.rs"
  echo '  curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh'
  exit 1
fi

if [ "$(uname -s)" = "Darwin" ]; then
  echo "[install-deps] macOS: Xcode Command Line Tools (skips if already installed)"
  xcode-select --install 2>/dev/null || true
  echo "[install-deps] Done. sqlite3 ships with macOS already."
else
  echo "[install-deps] Ubuntu/Debian: installing Tauri's Linux build dependencies + sqlite3"
  sudo apt-get update
  sudo apt-get install -y \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libssl-dev \
    build-essential \
    pkg-config \
    curl \
    wget \
    file \
    sqlite3
  echo "[install-deps] Done. If you installed rustup via snap, its shims may not be on PATH ahead of"
  echo "[install-deps] a distro cargo/rustc — scripts/qa.sh and scripts/verify.sh already handle that"
  echo "[install-deps] themselves (they resolve cargo via 'rustup which cargo'), but plain 'cargo'/'bun"
  echo "[install-deps] run tauri dev' in your own shell may need rustup's bin dir added to PATH first."
fi
