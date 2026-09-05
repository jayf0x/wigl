import { useEffect, useRef, useState } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/wigl/utils";
import type { MusicApi } from "../../useMusic";

export const VolumeControl = ({ api }: { api: MusicApi }) => {
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

  const Icon = api.volume === 0 ? VolumeX : api.volume < 50 ? Volume1 : Volume2;

  return (
    <div ref={wrapRef} className="flex items-center gap-2" data-no-drag>
      {open && (
        <>
          <Slider
            className="w-20"
            value={[api.volume]}
            min={0}
            max={100}
            onValueChange={(v) => api.setVolume(Array.isArray(v) ? v[0] : v)}
          />
          <span className="w-5 text-right text-[10px] text-muted-foreground tabular-nums">
            {Math.round(api.volume)}
          </span>
        </>
      )}
      <Button
        variant="ghost"
        data-no-drag
        aria-label={open ? "Hide volume" : "Volume"}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "mx-press h-auto rounded-md p-1 transition-colors hover:bg-transparent",
          open ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon className="size-3.5" />
      </Button>
    </div>
  );
};
