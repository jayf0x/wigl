import { useCallback, useState } from "react";
import { pickAndProcessImage } from "@/wigl/utils";
import { useStorage } from "./useStorage";

/** P7 — the one-image case of "let the user pick a picture and keep it": binds
 * a storage key to a downscaled `data:` URI. `pick()` opens the system file
 * chooser, resizes + re-encodes via Pillow, and stores the result; `url` is
 * whatever is stored now (or `null`); `clear()` removes it; `busy` is true
 * while the picker/convert is running.
 *
 * ```tsx
 * const cover = useUploader({ key: `music:playlist-cover:${id}` });
 * <img src={cover.url ?? fallback} />
 * <button onClick={cover.pick} disabled={cover.busy}>change</button>
 * ```
 *
 * Storage is the kv table (base64) — fine for a handful of small covers. A
 * many-images or large-image story wants the Tauri asset protocol; not built
 * (see `backlog.md`).
 */
export const useUploader = (opts: { key: string; maxEdge?: number }) => {
  const [url, setUrl] = useStorage<string | null>(opts.key, null);
  const [busy, setBusy] = useState(false);

  const pick = useCallback(async (): Promise<string | null> => {
    setBusy(true);
    try {
      const uri = await pickAndProcessImage(opts.maxEdge ?? 900);
      if (uri) setUrl(uri);
      return uri;
    } finally {
      setBusy(false);
    }
  }, [opts.maxEdge, setUrl]);

  const clear = useCallback(() => setUrl(null), [setUrl]);

  return { url, busy, pick, clear };
};
