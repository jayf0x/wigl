import { useState } from "react";
import { Disc3, Pause, Play, Radio, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/wigl/utils";
import type { MusicApi } from "../useMusic";
import { Equalizer } from "./Equalizer";

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
        <div className="flex size-full items-center justify-center text-muted-foreground/40">
          {radio ? <Radio className="size-1/3" /> : <Disc3 className="size-1/3" />}
        </div>
      )}
    </div>
  );
};

const TransportButton = ({
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
        ? "size-9 bg-primary text-primary-foreground hover:bg-primary/85"
        : "size-7 text-muted-foreground hover:text-foreground",
    )}
  >
    {children}
  </button>
);

export const NowPlaying = ({ api }: { api: MusicApi }) => {
  const { now } = api;
  const pct = now && now.duration > 0 ? Math.min(100, (now.elapsed / now.duration) * 100) : 0;

  return (
    <div className="flex flex-col gap-3 border-border border-b p-3">
      <div className="flex gap-3">
        <div className="w-24">
          <Artwork url={now?.artworkUrl ?? null} radio={!!now?.isRadio} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              {now?.isRadio ? (
                <>
                  <Equalizer bars={4} active={!!now?.playing} className="h-2.5 text-primary" />
                  <span className="music-tag">On air</span>
                </>
              ) : (
                <span className="music-tag">{now ? "Now playing" : "Idle"}</span>
              )}
            </div>
            <p className="music-serif mt-1 line-clamp-2 text-[19px] leading-[1.15] text-foreground">
              {now?.title ?? "Nothing queued"}
            </p>
            <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
              {now?.subtitle || (now ? "" : "Search below to start")}
            </p>
          </div>

          <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground tabular-nums">
            <span>{now?.isRadio ? "LIVE" : fmt(now?.elapsed ?? 0)}</span>
            <span className="relative h-px flex-1 bg-border">
              {!now?.isRadio && (
                <span
                  className="absolute inset-y-0 left-0 bg-primary"
                  style={{ width: `${pct}%` }}
                />
              )}
            </span>
            <span>{now?.isRadio ? "" : fmt(now?.duration ?? 0)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <TransportButton label="Previous track" onClick={api.previous}>
            <SkipBack className="size-4" fill="currentColor" />
          </TransportButton>
          <TransportButton
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
          </TransportButton>
          <TransportButton label="Next track" onClick={api.next}>
            <SkipForward className="size-4" fill="currentColor" />
          </TransportButton>
        </div>

        <Popover>
          <PopoverTrigger
            data-no-drag
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground text-xs tabular-nums transition-colors hover:text-foreground"
          >
            <Volume2 className="size-3.5" />
            {Math.round(api.volume)}
          </PopoverTrigger>
          <PopoverContent className="w-40" side="top" data-no-drag>
            <div className="flex items-center gap-2">
              <Volume2 className="size-3.5 shrink-0 text-muted-foreground" />
              <Slider
                value={[api.volume]}
                min={0}
                max={100}
                onValueChange={(v) => api.setVolume(Array.isArray(v) ? v[0] : v)}
              />
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
};
