// Bare command names, resolved via PATH by portable-pty's spawn (same as
// Rust's std::process::Command on a relative program name) — no absolute
// path probing needed, unlike the shell-out binaries in wigl-widgets/repos.
export const defaultShell = (): string =>
  navigator.userAgent.includes("Win") ? "powershell.exe" : "bash";

export const INITIAL_COLS = 80;
export const INITIAL_ROWS = 24;
