import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useStorage } from "../../hooks/useStorage";
import type { SettingSection } from "../types";

// F11 half 1. Desktop.tsx reads these same two keys directly (not through
// this section) to render the actual full-bleed layer — this file only owns
// the UI that writes them. A `background` plugin folder (F11 half 2, see
// docs/widgets.md) always takes precedence over this image when one's
// installed; this section still works either way, it just won't be visible
// on screen while a background plugin is active.
//
// ponytail: the image round-trips as a data URL straight into the kv blob
// (see useStorage) — the whole file's bytes, base64-inflated, in one SQLite
// row. Fine for a wallpaper-sized image; a large one bloats that row on
// every read/write. Upgrade path if that ever matters: write the bytes to a
// file under storageRoot() and store just the path here instead — not built
// now, only noted.
const BackgroundSection = () => {
  const [image, setImage] = useStorage<string | null>("wigl_background_image", null);
  const [opacity, setOpacity] = useStorage<number>("wigl_background_opacity", 1);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setImage(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 px-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-widest">
          Image
        </div>
        <div className="flex items-center gap-2 px-1">
          {/* A native file picker — no Tauri dialog plugin needed, this
              already opens the OS's real picker. Hidden and triggered via
              the button so it matches the rest of the modal's controls
              instead of the browser's own file-input chrome. */}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            {image ? "Change image" : "Choose image"}
          </Button>
          {image && (
            <Button variant="ghost" size="sm" onClick={() => setImage(null)}>
              Clear
            </Button>
          )}
        </div>
        {image && (
          <div
            className="mt-2 h-20 w-full rounded-md border border-border/60 bg-center bg-cover"
            style={{ backgroundImage: `url(${image})` }}
          />
        )}
      </div>

      {image && (
        <div className="border-border/60 border-t pt-3">
          <div className="flex items-center gap-2 px-1">
            <span className="w-16 shrink-0 text-xs">Opacity</span>
            <Slider
              min={0}
              max={1}
              step={0.01}
              value={opacity}
              onValueChange={(v) => setOpacity(Array.isArray(v) ? v[0] : v)}
            />
            <span className="w-9 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
              {Math.round(opacity * 100)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export const backgroundSection: SettingSection = {
  id: "desktop-background",
  label: "Background",
  fields: [
    { id: "background-image", label: "Background image", keywords: ["wallpaper", "photo", "picture"] },
    { id: "background-opacity", label: "Background opacity", keywords: ["wallpaper", "transparency", "fade"] },
  ],
  render: () => <BackgroundSection />,
};
