// The "app" Tier-2 namespace: one field, `mode`, mirroring lib.rs's
// windowed_mode() precedence (WIGL_MODE env var wins, then this override,
// then Linux/Wayland auto-detection). Split into its own module — not just
// inlined in Desktop.tsx's right-click action — because the mode-toggle
// action is meant to read as an immediate switch, not a queued Settings
// field: it writes the override *and* restarts in one call, unlike every
// other Tier-2 write (which only flags the restart banner and waits).
import { relaunch } from "@tauri-apps/plugin-process";
import { setConfigOverride } from "./config";

export type AppMode = "windowed" | "overlay";

/** The mode a toggle switches *to*, given the mode currently running. */
export const oppositeMode = (windowed: boolean): AppMode => (windowed ? "overlay" : "windowed");

/** Right-click menu label for the toggle action, given the mode currently
 * running. */
export const toggleModeLabel = (windowed: boolean): string =>
  windowed ? "Switch to desktop mode" : "Switch to windowed mode";

/** Persists the opposite mode as a Tier-2 override, then restarts
 * immediately — a right-click "switch" should read as an action, not a
 * pending change sitting behind the Settings modal's restart banner. */
export const toggleWindowedMode = async (windowed: boolean): Promise<void> => {
  await setConfigOverride("app", { mode: oppositeMode(windowed) });
  await relaunch();
};
