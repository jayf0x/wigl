import { Command } from "@tauri-apps/plugin-shell";
import { ProjectStatus } from "./repos.types";

// single string.
export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// Every binary here runs through `sh -c`, per capabilities: only `sh` and
// `sqlite3` are registered under shell:allow-execute (see backlog's
// "Capabilities posture" decision) — one real boundary instead of a
// decorative per-binary allowlist. Quote args ourselves since sh -c takes a
async function run(cmd: string) {
  const out = await Command.create("sh", ["-c", cmd]).execute();
  if (out.code !== 0) throw new Error(out.stderr || `command failed: ${cmd}`);
}

export function revealInFinder({ path }: ProjectStatus) {
  run(`open -R ${shQuote(path)}`).catch(console.error);
}

// bundled VS Code CLI first (reuses an already-open window instead of
// spawning a new one), falls back to `open -a` if VS Code isn't installed there.
// Absolute path, not bare `code` — GUI-launched shells often lack the PATH
// entry `code`'s "Shell Command: Install" step adds.
const VSCODE_CLI = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
export async function openInEditor({ path }: ProjectStatus) {
  try {
    await run(`${shQuote(VSCODE_CLI)} ${shQuote(path)}`);
  } catch {
    try {
      await run(`open -a "Visual Studio Code" ${shQuote(path)}`);
    } catch {
      // no VS Code install found — nothing more we can do
    }
  }
}

// "Install Command Line Tool" from GitHub Desktop's menu drops a `github`
// wrapper at /usr/local/bin — reuses an already-open window like `code` does.
// Falls back to the x-github-client:// URL scheme it always registers.
export async function openInGithubDesktop({ path }: ProjectStatus) {
  try {
    await run(`${shQuote("/usr/local/bin/github")} ${shQuote(path)}`);
  } catch {
    try {
      await run(`open ${shQuote(`x-github-client://openLocalRepo/${encodeURIComponent(path)}`)}`);
    } catch {
      // GitHub Desktop isn't installed — nothing more we can do
    }
  }
}
