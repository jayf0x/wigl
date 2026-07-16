import { Command } from "@tauri-apps/plugin-shell";
import { isMacos } from "@/wigl";
import { ProjectStatus } from "./types";

// single string.
export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// gh has its own API rate limit — callers should cache this (see useQuery in
// useReposWidget.ts), it's not meant to be called on every poll.
// Homebrew's /opt/homebrew/bin isn't on a GUI-launched shell's minimal PATH
// (same problem as the editor CLI below) — try the Homebrew path first on
// macOS, fall back to whatever `gh` resolves to on PATH everywhere else.
export async function loadArchivedRepoNames(): Promise<string[]> {
  const candidates = (await isMacos()) ? ["/opt/homebrew/bin/gh", "gh"] : ["gh"];
  for (const gh of candidates) {
    const out = await Command.create("sh", [
      "-c",
      `${shQuote(gh)} repo list --archived --limit 1000 --json name --jq '.[].name'`,
    ]).execute();
    if (out.code === 0) return out.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

// Every binary here runs through `sh -c`, per capabilities: only `sh` and
// `sqlite3` are registered under shell:allow-execute (see backlog's
// "Capabilities posture" decision) — one real boundary instead of a
// decorative per-binary allowlist. Quote args ourselves since sh -c takes a
async function run(cmd: string) {
  const out = await Command.create("sh", ["-c", cmd]).execute();
  if (out.code !== 0) throw new Error(out.stderr || `command failed: ${cmd}`);
}

// macOS: `open -R` reveals+selects the path in Finder. Linux has no
// cross-desktop equivalent of "reveal and select" — `xdg-open` on the repo
// dir itself (opens it in whatever file manager is registered) is the
// closest generic behavior and works the same across GNOME/KDE/etc.
export async function revealInFileManager({ path }: ProjectStatus) {
  const cmd = (await isMacos()) ? `open -R ${shQuote(path)}` : `xdg-open ${shQuote(path)}`;
  run(cmd).catch(console.error);
}

// bundled VS Code CLI first (reuses an already-open window instead of
// spawning a new one), falls back to `open -a` if VS Code isn't installed there.
// Absolute path, not bare `code` — GUI-launched shells often lack the PATH
// entry `code`'s "Shell Command: Install" step adds.
const VSCODE_CLI_MAC = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
export async function openInEditor({ path }: ProjectStatus) {
  if (await isMacos()) {
    try {
      await run(`${shQuote(VSCODE_CLI_MAC)} ${shQuote(path)}`);
    } catch {
      try {
        await run(`open -a "Visual Studio Code" ${shQuote(path)}`);
      } catch {
        // no VS Code install found — nothing more we can do
      }
    }
    return;
  }
  // Linux: apt/snap installs of VS Code usually put `code` on PATH already,
  // but a GUI-launched shell can still miss it (same PATH gap as macOS's
  // Homebrew case above) — try the common absolute install locations first.
  for (const bin of ["/usr/bin/code", "/snap/bin/code", "code"]) {
    try {
      await run(`${shQuote(bin)} ${shQuote(path)}`);
      return;
    } catch {
      // try the next candidate
    }
  }
}

// "Install Command Line Tool" from GitHub Desktop's menu drops a `github`
// wrapper at /usr/local/bin — reuses an already-open window like `code` does.
// Falls back to the x-github-client:// URL scheme it always registers.
export async function openInGithubDesktop({ path }: ProjectStatus) {
  if (await isMacos()) {
    try {
      await run(`${shQuote("/usr/local/bin/github")} ${shQuote(path)}`);
    } catch {
      try {
        await run(`open ${shQuote(`x-github-client://openLocalRepo/${encodeURIComponent(path)}`)}`);
      } catch {
        // GitHub Desktop isn't installed — nothing more we can do
      }
    }
    return;
  }
  // GitHub Desktop has no official Linux build; the community fork
  // (shiftkey/desktop, installed via apt/AppImage) provides a `github-desktop`
  // binary on PATH. No absolute-path fallback here — unlike VS Code, there's
  // no single conventional install location to guess at.
  try {
    await run(`${shQuote("github-desktop")} ${shQuote(path)}`);
  } catch {
    // GitHub Desktop isn't installed — nothing more we can do
  }
}
