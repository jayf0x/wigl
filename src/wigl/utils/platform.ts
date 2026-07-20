import { runCmd } from "./command";

// OS detection via `uname -s`, not a Tauri plugin — consistent with this
// app's "shell out to a real CLI" rule (see AGENTS.md #3). Cached since the
// OS obviously never changes mid-session.
let macosPromise: Promise<boolean> | null = null;
export const isMacos = (): Promise<boolean> => {
  macosPromise ??= runCmd("sh", ["-c", "uname -s"]).then((out) => out.stdout.trim() === "Darwin");
  return macosPromise;
};
