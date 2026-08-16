/**
 * Shared plumbing for the widgets-root e2e suite (see ./README.md for what
 * this suite proves and why). Nothing here is widget-specific — it's just
 * "run a wigl CLI command as a real subprocess, against a real temp
 * filesystem, and hand back what happened" so the test file itself can stay
 * readable as a list of scenarios.
 */
import { cp as fsCp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** tests/e2e/ -> repo root. Every subprocess this suite spawns runs with
 * this as `cwd`, since scripts/widget.ts resolves its own repo-relative
 * paths (wigl-widgets/tsconfig.json, src-tauri/tauri.conf.json, ...) against
 * the process cwd, not against import.meta.dir. */
export const repoRoot = resolve(import.meta.dir, "../..");

export const fixturesDir = join(import.meta.dir, "fixtures");

/** Every temp dir this suite creates, so a single afterAll can sweep them
 * all regardless of which scenario created which. Call `trackTemp` right
 * after every `mkdtemp` — nothing here relies on OS temp-dir auto-cleanup. */
const tempDirs: string[] = [];
export const trackTemp = (dir: string): string => {
  tempDirs.push(dir);
  return dir;
};
export const cleanupTemp = async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
};

/** A fresh, empty, cross-platform temp dir (works identically on macOS,
 * Linux, and Windows — `os.tmpdir()` + `mkdtemp` is the only part of this
 * suite that has to be, since everything downstream is plain node:fs/path
 * and `Bun.spawn`, none of which are shell scripts). */
export const makeTempDir = async (prefix: string) => trackTemp(await mkdtemp(join(tmpdir(), prefix)));

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `bun scripts/widget.ts <args>` as a real child process — not a
 * direct function call into widget.ts — because the thing under test is
 * "does the CLI, as invoked, behave correctly with these env vars and this
 * cwd," which an in-process import would quietly sidestep (module-level
 * consts like WIDGETS_ROOT are read once at import time). */
export const runWidgetCli = async (
  args: string[],
  opts: { env?: Record<string, string | undefined>; production?: boolean } = {},
): Promise<CliResult> => {
  const proc = Bun.spawn(["bun", "scripts/widget.ts", ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...(opts.production === false ? {} : { NODE_ENV: "production" }),
      ...opts.env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
};

/** Same as `runWidgetCli`, but lets the caller pick `cwd` and invokes the
 * script by its absolute path instead of the repo-relative `scripts/widget.ts`
 * — this is what actually changes between "run via `bun run widget:*`" and
 * "run from wherever the user's shell happens to be" (e.g. a global alias
 * invoked after `cd ~`). Exists specifically to prove `scripts/widget.ts`'s
 * own repo-relative paths (tauri.conf.json, wigl-widgets/tsconfig.json,
 * node_modules) resolve against the script's location, not the caller's cwd
 * — see the "invoked from an unrelated cwd" describe block below. */
export const runWidgetCliFrom = async (
  cwd: string,
  args: string[],
  opts: { env?: Record<string, string | undefined> } = {},
): Promise<CliResult> => {
  const scriptPath = join(repoRoot, "scripts", "widget.ts");
  const proc = Bun.spawn(["bun", scriptPath, ...args], {
    cwd,
    env: { ...process.env, NODE_ENV: "production", ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
};

/** `tsc -p <dir> --noEmit` against the repo's own installed TypeScript (not
 * a global `tsc` — this must typecheck the same compiler version the repo
 * is pinned to). `<dir>` is expected to already contain a `tsconfig.json` +
 * `types/` pair, i.e. the output of `widget:devkit` — see `exportDevkit`
 * below. */
export const typecheck = async (dir: string): Promise<CliResult> => {
  const tscBin = join(repoRoot, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
  const proc = Bun.spawn([tscBin, "-p", dir, "--noEmit"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
};

/** Runs `widget:devkit` once into a fresh temp dir and returns it — the
 * (tsconfig.json, types/) pair a widget folder needs to typecheck outside
 * this repo. Expensive (recompiles the app's whole type surface via `tsc -p
 * tsconfig.types.json`), so call it once per test run and copy its output
 * into each scenario's own root instead of re-exporting per scenario. */
export const exportDevkit = async (): Promise<string> => {
  const dir = await makeTempDir("wigl-e2e-devkit-");
  const result = await runWidgetCli(["devkit", dir]);
  if (result.code !== 0) {
    throw new Error(`widget:devkit failed:\n${result.stdout}\n${result.stderr}`);
  }
  return dir;
};

/** Builds one scenario's external "widgets root": a fresh temp dir seeded
 * with a copy of the shared devkit's tsconfig.json + types/, plus a copy of
 * each named fixture under tests/e2e/fixtures/. This is deliberately a
 * copy, not a symlink or shared dir across scenarios — each scenario gets
 * its own root so a build/install in one can't leak state into another. */
export const makeScenarioRoot = async (devkitDir: string, fixtureNames: string[]): Promise<string> => {
  const dir = await makeTempDir("wigl-e2e-root-");
  await fsCp(join(devkitDir, "tsconfig.json"), join(dir, "tsconfig.json"));
  await fsCp(join(devkitDir, "types"), join(dir, "types"), { recursive: true });
  const hasNodeModules = await stat(join(devkitDir, "node_modules"))
    .then((s) => s.isDirectory())
    .catch(() => false);
  if (hasNodeModules) {
    await fsCp(join(devkitDir, "node_modules"), join(dir, "node_modules"), { recursive: true });
  }
  for (const name of fixtureNames) {
    await fsCp(join(fixturesDir, name), join(dir, name), { recursive: true });
  }
  return dir;
};

export const readInstalled = async (appDataDir: string, id: string, relPath: string) =>
  readFile(join(appDataDir, "plugins", id, relPath), "utf8");
