import { Command } from "@tauri-apps/plugin-shell";

/** Shorthand for the common `Command.create(...).execute()` one-shot —
 * use `Command.create(...).spawn()` directly instead when you need to
 * stream output (see the repos widget's clone-progress row for that shape). */
export const runCmd = (...args: Parameters<typeof Command.create>) => Command.create(...args).execute();
