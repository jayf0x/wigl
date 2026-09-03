// P7 — pick a local image and turn it into a small, web-friendly `data:` URI a
// widget can store in the kv table and render with a plain `<img src>`. No
// native file-dialog plugin and no Tauri asset protocol (neither is available
// to a widget); a system file chooser (osascript / zenity) plus one shell hop
// through Python/Pillow for the resize + re-encode. Needs only the `command`
// permission a widget already tends to hold.
//
// Pillow (`pip install Pillow`, see global-deps.md) rather than sips /
// ImageMagick — those varied enough between machines to be a real source of
// bugs (`wigl-widgets/music` shipped a broken sips invocation once).

import { isMacos, runCmd } from "./index";

// Single physical line (no compound statements) so it passes safely as
// `python3 -c '<this>'` — it uses only double quotes, so wrapping in single
// quotes in the shell needs no escaping.
const PY =
  'import sys,base64,io;from PIL import Image,ImageOps;' +
  's,m=sys.argv[1],int(sys.argv[2]);' +
  'im=ImageOps.exif_transpose(Image.open(s)).convert("RGB");' +
  'im.thumbnail((m,m));b=io.BytesIO();im.save(b,format="JPEG",quality=82,optimize=True);' +
  'sys.stdout.write("data:image/jpeg;base64,"+base64.b64encode(b.getvalue()).decode())';

const MAC_PICK =
  `osascript -e 'POSIX path of (choose file with prompt "Choose an image" of type {"public.image"})' 2>/dev/null`;
const LINUX_PICK = `zenity --file-selection --title="Choose an image" 2>/dev/null`;

/** ~900 KB of base64 — a cover this big already lives in the widget's kv blob;
 * keep it modest. */
const MAX_URI_LEN = 900_000;

/** Opens a system image picker, downscales the chosen file to `maxEdge` on its
 * long side and re-encodes it as JPEG, and resolves to a
 * `data:image/jpeg;base64,…` URI — or `null` if the user cancelled, a tool is
 * missing (no `python3` / Pillow / `zenity`), or the result is too large. */
export const pickAndProcessImage = async (maxEdge = 900): Promise<string | null> => {
  const pick = (await isMacos().catch(() => false)) ? MAC_PICK : LINUX_PICK;
  const script = `
set -e
f=$(${pick}) || exit 1
[ -n "$f" ] || exit 1
python3 -c '${PY}' "$f" ${Math.max(64, Math.round(maxEdge))}
`;
  const out = await runCmd("sh", ["-c", script]).catch(() => null);
  if (!out || out.code !== 0) return null;
  const uri = out.stdout.trim();
  return uri.startsWith("data:image/") && uri.length <= MAX_URI_LEN ? uri : null;
};
