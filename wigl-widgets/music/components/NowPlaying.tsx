import { useEffect, useRef, useState } from "react";
import { Disc3, Pause, Play, Radio, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/wigl/utils";
import type { MusicApi } from "../useMusic";

const fmt = (s: number) => {
  if (!s || s < 0 || !Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

const Artwork = ({ url, radio }: { url: string | null; radio: boolean }) => {
  const [broken, setBroken] = useState(false);
  return (
    <div className="relative aspect-square w-full shrink-0 overflow-hidden rounded-md border border-border bg-background">
      {url && !broken ? (
        <img
          src={url}
          alt=""
          className="size-full object-cover"
          onError={() => setBroken(true)}
          draggable={false}
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground/30">
          {radio ? <Radio className="size-1/3" /> : <Disc3 className="size-1/3" />}
        </div>
      )}
    </div>
  );
};

const IconBtn = ({
  onClick,
  label,
  primary,
  children,
}: {
  onClick: () => void;
  label: string;
  primary?: boolean;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    data-no-drag
    aria-label={label}
    onClick={onClick}
    className={cn(
      "flex items-center justify-center rounded-full transition-colors duration-150",
      primary
        ? "size-9 bg-foreground text-background hover:bg-foreground/85"
        : "size-7 text-muted-foreground hover:text-foreground",
    )}
  >
    {children}
  </button>
);

const VolumeControl = ({ api }: { api: MusicApi }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Collapse when focus/pointer leaves the control — no popover, no portal,
  // so nothing can escape the widget bounds (which was letting clicks fall
  // through to the desktop).
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
      <button
        type="button"
        data-no-drag
        aria-label={open ? "Hide volume" : "Volume"}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "rounded-md p-1 transition-colors",
          open ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon className="size-3.5" />
      </button>
    </div>
  );
};

export const NowPlaying = ({ api }: { api: MusicApi }) => {
  const { now } = api;
  const pct = now && now.duration > 0 ? Math.min(100, (now.elapsed / now.duration) * 100) : 0;

  return (
    <div className="flex flex-col gap-3 border-border border-b p-3">
      <div className="flex gap-3">
        <div className="w-20">
          <Artwork url={now?.artworkUrl ?? null} radio={!!now?.isRadio} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <p className="music-serif line-clamp-2 text-[18px] leading-[1.15] text-foreground">
            {now?.title ?? "Nothing playing"}
          </p>
          <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
            {now?.isRadio ? "Live radio" : now?.subtitle || (now ? "" : "Search to start")}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums">
        <span className="w-8">{now?.isRadio ? "live" : fmt(now?.elapsed ?? 0)}</span>
        <span className="relative h-px flex-1 bg-border">
          {!now?.isRadio && now && (
            <span className="absolute inset-y-0 left-0 bg-foreground" style={{ width: `${pct}%` }} />
          )}
        </span>
        <span className="w-8 text-right">{now && !now.isRadio ? fmt(now.duration) : ""}</span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <IconBtn label="Previous track" onClick={api.previous}>
            <SkipBack className="size-4" fill="currentColor" />
          </IconBtn>
          <IconBtn
            label={now?.playing ? "Pause" : "Play"}
            primary
            onClick={() => {
              api.unlock();
              api.playPause();
            }}
          >
            {now?.playing ? (
              <Pause className="size-4" fill="currentColor" />
            ) : (
              <Play className="size-4 translate-x-px" fill="currentColor" />
            )}
          </IconBtn>
          <IconBtn label="Next track" onClick={api.next}>
            <SkipForward className="size-4" fill="currentColor" />
          </IconBtn>
        </div>

        <VolumeControl api={api} />
      </div>
    </div>
  );
};
