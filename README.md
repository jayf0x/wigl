# wigl

A macOS desktop-widget app: small always-on-bottom panels (clock, repos, calendar, ...) tiled on a per-monitor grid, backed by Tauri 2 + React 19 + TypeScript. Data comes from shelling out to real CLI tools (`git`, `sqlite3`, ...), not custom Rust — see `docs/architecture.md`.

Start with `AGENTS.md` for the contracts and hard rules, then `docs/` for the reasoning behind them (`docs/widgets.md` for adding a widget, `docs/architecture.md` for how windows/data flow work, `docs/debugging.md` for verification). Open defects and decisions live in `backlog.md`.
