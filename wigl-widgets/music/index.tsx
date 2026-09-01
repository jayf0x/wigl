import { useEffect, useRef } from "react";
import { AudioLines } from "lucide-react";
import { ErrorOverlay, Widget } from "@/wigl";
import { cn } from "@/wigl/utils";
import "./music.css";
import { Browser } from "./components/Browser";
import { Equalizer } from "./components/Equalizer";
import { NowPlaying } from "./components/NowPlaying";
import { useMusic } from "./useMusic";

const StatusDot = ({ state }: { state: ReturnType<typeof useMusic>["state"] }) => {
  const color =
    state === "ready"
      ? "bg-foreground"
      : state === "offline"
        ? "bg-destructive"
        : "bg-muted-foreground animate-pulse";
  const label =
    state === "ready" ? "connected" : state === "offline" ? "offline" : "connecting";
  return (
    <span className="flex items-center gap-1.5" title={`Music Assistant: ${label}`}>
      <span className={cn("size-1.5 rounded-full", color)} />
    </span>
  );
};

const MusicWidget = () => {
  const api = useMusic();
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Keyboard: `/` focus search, space play/pause, ←/→ seek ±5s, n/p next/prev
  // — all suppressed while typing or with a button focused.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const interactive =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable ||
        !!target.closest("button");
      if (interactive) return;
      if (e.key === "/") {
        e.preventDefault();
        api.navHome();
        setTimeout(() => searchRef.current?.focus(), 0);
      } else if (e.key === " ") {
        e.preventDefault();
        api.unlock();
        api.playPause();
      } else if (e.key === "ArrowRight" && api.now && !api.now.isRadio) {
        e.preventDefault();
        api.seek(api.now.elapsed + 5);
      } else if (e.key === "ArrowLeft" && api.now && !api.now.isRadio) {
        e.preventDefault();
        api.seek(api.now.elapsed - 5);
      } else if (e.key === "n") {
        api.next();
      } else if (e.key === "p") {
        api.previous();
      }
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, [api]);

  return (
    <Widget
      w={7}
      h={11}
      col={0}
      row={0}
      className="music-widget"
      minimizedBackground={
        api.now?.playing ? (
          <Equalizer bars={5} className="h-4 text-foreground" />
        ) : (
          <AudioLines className="size-4 text-muted-foreground" />
        )
      }
      headerContent={
        <>
          <span className="music-tag text-foreground/70">music</span>
          <span className="ml-auto flex items-center gap-2">
            <StatusDot state={api.state} />
          </span>
        </>
      }
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: keyboard shortcuts scoped to the widget */}
      <div
        ref={rootRef}
        className="music-cq flex min-h-0 flex-1 flex-col outline-none"
        tabIndex={-1}
      >
        {api.state === "offline" ? (
          <ErrorOverlay
            kind="known"
            title="Music Assistant isn’t running"
            message={
              api.error ??
              `Start it with:  docker start wigl-ma  — or turn on "Auto-start server" in this widget's settings.`
            }
            onRetry={api.retry}
          />
        ) : (
          <>
            <NowPlaying api={api} />
            <Browser api={api} inputRef={searchRef} />
          </>
        )}
      </div>
    </Widget>
  );
};

export default MusicWidget;
