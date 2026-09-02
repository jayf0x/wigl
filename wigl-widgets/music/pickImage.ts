// E3 — pick a local image for a playlist background without a native file-
// dialog plugin or the Tauri asset protocol (neither is available to a widget):
// a system file chooser (osascript / zenity) + a downscale + base64 through one
// `sh -c`, returning a self-contained data URI the caller persists via
// `useStorage`. Needs only the `command` permission the widget already holds.
//
// If a proper picker is ever wanted (multi-select, drag-drop, a preview), that
// needs `tauri-plugin-dialog` + a host module — see backlog-music.md.

import { isMacos, runCmd } from "@/wigl/utils";

// macOS: `choose file` dialog → `sips` downscale to 900px long-edge JPEG → b64.
// `mktemp -d` (a real dir) — the old `$(mktemp)/bg.jpg` treated the temp *file*
// as a directory, so `mkdir -p` failed under `set -e` and every pick silently
// returned null (P0.7).
const MAC_SCRIPT = `
set -e
f=$(osascript -e 'POSIX path of (choose file with prompt "Choose a background image" of type {"public.image"})' 2>/dev/null) || exit 1
[ -n "$f" ] || exit 1
d=$(mktemp -d)
out="$d/bg.jpg"
sips -s format jpeg -Z 900 "$f" --out "$out" >/dev/null 2>&1 || cp "$f" "$out"
base64 < "$out" | tr -d '\\n'
rm -rf "$d"
`;

// Linux: zenity chooser → ImageMagick downscale if present → b64.
const LINUX_SCRIPT = `
set -e
f=$(zenity --file-selection --title="Choose a background image" 2>/dev/null) || exit 1
[ -n "$f" ] || exit 1
out=$(mktemp).jpg
( convert "$f" -resize '900x900>' -quality 82 "$out" 2>/dev/null && src="$out" ) || src="$f"
base64 -w0 < "$src"
rm -f "$out"
`;

/** ~675 KB of decoded image — a data URI this big lives in the widget's kv
 * blob, so keep it modest. */
const MAX_B64_LEN = 900_000;

/** Opens a system file picker; resolves to a `data:image/jpeg;base64,…` URI, or
 * null if the user cancelled, the tool is missing, or the file is too large. */
export const pickImageDataUri = async (): Promise<string | null> => {
  const script = (await isMacos().catch(() => false)) ? MAC_SCRIPT : LINUX_SCRIPT;
  const out = await runCmd("sh", ["-c", script]).catch(() => null);
  if (!out || out.code !== 0) return null;
  const b64 = out.stdout.trim();
  if (!b64 || b64.length > MAX_B64_LEN || /\s/.test(b64)) return null;
  return `data:image/jpeg;base64,${b64}`;
};
