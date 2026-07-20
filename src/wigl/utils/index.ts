// Plain, non-React helpers shared across the app
// from "@/wigl/utils". Stateful/React-specific logic lives in "@/wigl/hooks"
// instead — see that folder's barrel.

import { Command } from "@tauri-apps/plugin-shell";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Shorthand for the common `Command.create(...).execute()` one-shot —
 * use `Command.create(...).spawn()` directly instead when you need to
 * stream output (see the repos widget's clone-progress row for that shape). */
export const runCmd = (...args: Parameters<typeof Command.create>) => Command.create(...args).execute();

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
