# wigl

A macOS + Linux (Ubuntu) desktop-widget app: small panels (clock, repos, calendar, ...) tiled on a grid, backed by Tauri 2 + React 19 + TypeScript. Data comes from shelling out to real CLI tools (`git`, `sqlite3`, ...), not custom Rust — see `docs/architecture.md`. Runs as a desktop overlay on macOS/X11, or a single normal window on Wayland (Ubuntu's default) — see that same doc.

Start with `AGENTS.md` for the contracts and hard rules, then `docs/` for the reasoning behind them (`docs/widgets.md` for adding a widget, `docs/architecture.md` for how windows/data flow work, `docs/debugging.md` for verification). Open defects and decisions live in `backlog.md`.

## Getting set up

Needs a Rust toolchain (`rustup` — https://rustup.rs) and bun, plus a couple of system packages on Linux. `bun run setup` (`scripts/install-deps.sh`) installs the Linux ones (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libssl-dev`, build tooling, `sqlite3`) via `apt`; on macOS it just prompts for Xcode Command Line Tools if missing (sqlite3 already ships with macOS). Then `bun install`.

For fast local QA once set up: `bun run qa` (auto-detects overlay vs. windowed mode the same way the app does) or `bun run qa:app` (forces the windowed flow everywhere, so you can QA it on macOS too, not just Wayland). Both kill any previously running instance first. See `docs/debugging.md` for the fuller `bun run verify` check.
