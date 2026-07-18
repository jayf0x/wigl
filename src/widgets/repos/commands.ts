import { homeDir } from "@tauri-apps/api/path";
import { Command } from "@tauri-apps/plugin-shell";
import { isMacos } from "@/wigl";
import { ProjectStatus, RemoteRepo } from "./types";

// single string.
export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// `~` isn't expanded by anything downstream: `shQuote` single-quotes it
// before it reaches a shell (which disables tilde expansion anyway), and
// Node's `existsSync` (in scripts/repos-scan.ts) never expands it either —
// so a path typed as "~/code" silently scanned nothing. Resolve `~` here,
// once, before the path is stored or used.
export async function resolveSourceDir(input: string): Promise<string> {
  const trimmed = input.trim();
  if (trimmed === "~") return homeDir();
  if (trimmed.startsWith("~/")) return `${(await homeDir()).replace(/\/$/, "")}${trimmed.slice(1)}`;
  return trimmed;
}

export async function sourceDirExists(path: string): Promise<boolean> {
  const out = await Command.create("sh", ["-c", `[ -d ${shQuote(path)} ] && echo yes`]).execute();
  return out.stdout.trim() === "yes";
}

// gh has its own API rate limit — callers should cache calls through this
// (see useQuery in useReposWidget.ts/useRemoteRepos.ts), not call it on every
// poll. Homebrew's /opt/homebrew/bin isn't on a GUI-launched shell's minimal
// PATH (same problem as the editor CLI below) — try the Homebrew path first
// on macOS, fall back to whatever `gh` resolves to on PATH everywhere else.
async function runGh(argsString: string) {
  const candidates = (await isMacos()) ? ["/opt/homebrew/bin/gh", "gh"] : ["gh"];
  let last: { code: number | null; stdout: string; stderr: string } = { code: 1, stdout: "", stderr: "" };
  for (const gh of candidates) {
    const out = await Command.create("sh", ["-c", `${shQuote(gh)} ${argsString}`]).execute();
    if (out.code === 0) return out;
    last = out;
  }
  return last;
}

export async function loadArchivedRepoNames(): Promise<string[]> {
  const out = await runGh("repo list --archived --limit 1000 --json name --jq '.[].name'");
  if (out.code !== 0) return [];
  return out.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

// `gh api --paginate` walks every page of the REST list (100 at a time via
// `per_page`, following the response's Link header) and concatenates each
// page's --jq output, so this returns every repo the user owns in one call
// — the pagination the task asks for is `gh`'s, not hand-rolled here.
// `--method GET` is required: `gh api` defaults to POST once a `-F`/`-f` flag
// is present.
export async function loadRemoteRepos(): Promise<RemoteRepo[]> {
  const jq = ".[] | {name, fullName: .full_name, cloneUrl: .clone_url, private: .private, updatedAt: .updated_at}";
  const out = await runGh(
    `api --method GET --paginate -F per_page=100 '/user/repos?affiliation=owner&sort=updated' --jq ${shQuote(jq)}`,
  );
  if (out.code !== 0) throw new Error(out.stderr || "gh api failed");
  return out.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RemoteRepo);
}

// Clones into `destDir`, reporting each progress line (git writes them with
// `\r` between updates, not `\n` — the shell plugin's Rust side splits on
// either, so `onProgress` still fires once per update, see docs/debugging.md
// if this ever stops behaving that way). `2>&1` merges stderr (where
// `--progress` writes) into the one stream we listen on.
export async function cloneRepo(repo: RemoteRepo, destDir: string, onProgress: (line: string) => void): Promise<void> {
  const cmd = Command.create("sh", ["-c", `git clone --progress ${shQuote(repo.cloneUrl)} ${shQuote(destDir)} 2>&1`]);
  return new Promise((resolve, reject) => {
    cmd.stdout.on("data", (line) => onProgress(line.replace(/[\r\n]+$/, "")));
    cmd.on("error", (err) => reject(new Error(err)));
    cmd.on("close", (data) => {
      if (data.code === 0) resolve();
      else reject(new Error(`git clone exited with code ${data.code}`));
    });
    cmd.spawn().catch(reject);
  });
}

// Every binary here runs through `sh -c`, per capabilities: only `sh` and
// `sqlite3` are registered under shell:allow-execute (see backlog's
// "Capabilities posture" decision) — one real boundary instead of a
// decorative per-binary allowlist. Quote args ourselves since sh -c takes a
async function run(cmd: string) {
  const out = await Command.create("sh", ["-c", cmd]).execute();
  if (out.code !== 0) throw new Error(out.stderr || `command failed: ${cmd}`);
}

// Stages everything and commits in one go — this widget doesn't do partial/
// selective staging, just the common "commit all my changes" case. Throws on
// failure (e.g. a failing pre-commit hook) so the caller can leave the
// message box open instead of silently discarding what the user typed.
export async function commitAllChanges({ path }: ProjectStatus, message: string) {
  await run(`git -C ${shQuote(path)} add -A && git -C ${shQuote(path)} commit -m ${shQuote(message)}`);
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
