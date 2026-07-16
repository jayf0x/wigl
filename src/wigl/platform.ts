// OS detection via `uname -s`, not a Tauri plugin — consistent with this
// app's "shell out to a real CLI" rule (see AGENTS.md #3). Cached since the
// OS obviously never changes mid-session.
import { Command } from "@tauri-apps/plugin-shell";

let macosPromise: Promise<boolean> | null = null;
export function isMacos(): Promise<boolean> {
  macosPromise ??= Command.create("sh", ["-c", "uname -s"])
    .execute()
    .then((out) => out.stdout.trim() === "Darwin");
  return macosPromise;
}
