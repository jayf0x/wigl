// Plain, non-React helpers shared across the app
// from "@/wigl/utils". Stateful/React-specific logic lives in "@/wigl/hooks"
// instead — see that folder's barrel.

import { homeDir as tauriHomeDir } from "@tauri-apps/api/path";
import { Command } from "@tauri-apps/plugin-shell";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Shorthand for the common `Command.create(...).execute()` one-shot — use
 * `runCmdStreaming` instead when you need to observe output as it arrives
 * (progress bars, live logs) rather than only the final result. */
export const runCmd = (...args: Parameters<typeof Command.create>) => Command.create(...args).execute();

/** Streams a command's stdout line-by-line via `onLine` and resolves with
 * its exit code once it closes — the mediated equivalent of
 * `Command.create(...).spawn()` for callers (including plugins) that can't
 * hold a raw `Command` handle. Merge stderr into the stream yourself
 * (`2>&1` in a `sh -c` command) if you want to see it, same as `runCmd`. */
export const runCmdStreaming = (
  program: Parameters<typeof Command.create>[0],
  args: Parameters<typeof Command.create>[1],
  onLine: (line: string) => void,
): Promise<{ code: number | null }> => {
  const cmd = Command.create(program, args);
  return new Promise((resolve, reject) => {
    cmd.stdout.on("data", (line) => onLine(line.replace(/[\r\n]+$/, "")));
    cmd.on("error", (err) => reject(new Error(err)));
    cmd.on("close", (data) => resolve({ code: data.code }));
    cmd.spawn().catch(reject);
  });
};

/** Spawns a long-lived process (a local server, not a one-shot command) and
 * hands back a `stop()` to kill it later — the mediated equivalent of
 * `Command.create(...).spawn()` that returns the `Child` handle itself.
 * Unlike `runCmdStreaming`, the returned promise never resolves on its own;
 * callers own the process's lifetime and must call `stop()` when done with
 * it (widget unmount, a "disconnect" action, ...). Use this only for
 * processes that don't exit by themselves — `runCmdStreaming` is still
 * right for anything that finishes on its own (builds, clones, ...). */
export const runCmdBackground = async (
  program: Parameters<typeof Command.create>[0],
  args: Parameters<typeof Command.create>[1],
  onLine: (line: string) => void,
): Promise<{ stop: () => Promise<void> }> => {
  const cmd = Command.create(program, args);
  cmd.stdout.on("data", (line) => onLine(line.replace(/[\r\n]+$/, "")));
  const child = await cmd.spawn();
  return { stop: () => child.kill() };
};

/** The user's home directory, trailing slash stripped so callers can always
 * join with a plain template string (this app targets macOS/Linux only, so
 * `/` is always the right separator — no path-joining host module needed).
 * Mediated so plugins never hold a raw `@tauri-apps/api/path` handle (see
 * `docs/plugins.md`'s host module registry section). */
export const homeDir = async (): Promise<string> => (await tauriHomeDir()).replace(/\/$/, "");

/** Merges Tailwind classes, later ones winning on conflicting utilities. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

// OS detection via `uname -s`, not a Tauri plugin — consistent with this
// app's "shell out to a real CLI" rule (see AGENTS.md #3). Cached since the
// OS obviously never changes mid-session.
let macosPromise: Promise<boolean> | null = null;
export const isMacos = (): Promise<boolean> => {
  macosPromise ??= runCmd("sh", ["-c", "uname -s"]).then((out) => out.stdout.trim() === "Darwin");
  return macosPromise;
};

/** "3m" / "2h" / "5d" / "1w" from an epoch-seconds timestamp — pure formatting,
 * no ticking. For a label that keeps itself current, use `useRelativeTime`
 * from `@/wigl/hooks` instead. */
export const relativeTime = (epochSeconds: number, present = Date.now()) => {
  if (!epochSeconds) return "?";
  const diff = Math.max(0, present / 1000 - epochSeconds);
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 604800)}w`;
};
