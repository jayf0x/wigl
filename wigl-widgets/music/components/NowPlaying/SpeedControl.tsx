import { useEffect, useRef, useState } from "react";
import { Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { MusicApi } from "../../useMusic";
import { fmtSpeed } from "./format";
import { IconBtn } from "./IconBtn";

/** P2 — server-side atempo. Mirrors VolumeControl: an icon button that folds
 * out a compact slider. `active` and a badge on the scrubber row surface a
 * non-1× rate; hidden entirely for radio (a live stream can't be stretched). */
export const SpeedControl = ({ api }: { api: MusicApi }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = wrapRef.current;
    if (!el) return;
    const close = (e: Event) => {
      if (!el.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open]);

  const off = api.playbackSpeed === 1;

  return (
    <div ref={wrapRef} className="flex items-center gap-2" data-no-drag>
      {open && (
        <>
          <Slider
            className="w-20"
            value={[api.playbackSpeed]}
            min={0.5}
            max={2}
            step={0.05}
            onValueChange={(v) => api.setPlaybackSpeed(Array.isArray(v) ? v[0] : v)}
          />
          <Button
            variant="ghost"
            data-no-drag
            aria-label="Reset speed to normal"
            onClick={() => api.setPlaybackSpeed(1)}
            className="mx-press h-auto w-9 p-0 text-right text-[10px] text-muted-foreground tabular-nums hover:bg-transparent hover:text-foreground"
          >
            {fmtSpeed(api.playbackSpeed)}
          </Button>
        </>
      )}
      <IconBtn
        label={off ? "Playback speed" : `Playback speed ${fmtSpeed(api.playbackSpeed)}`}
        active={!off}
        onClick={() => setOpen((v) => !v)}
      >
        <Gauge className="size-3.5" />
      </IconBtn>
    </div>
  );
};
