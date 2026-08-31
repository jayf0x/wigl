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
      ? "bg-primary"
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

  // Phase 3 keys: `/` focuses search, space toggles play/pause (unless typing).
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
      if (e.key === "/" && !interactive) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === " " && !interactive) {
        e.preventDefault();
        api.unlock();
        api.playPause();
      }
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, [api.playPause, api.unlock]);

  return (
    <Widget
      w={5}
      h={7}
      col={0}
      row={0}
      className="music-widget"
      minimizedBackground={
        api.now?.playing ? (
          <Equalizer bars={5} className="h-4 text-primary" />
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
      <div ref={rootRef} className="flex min-h-0 flex-1 flex-col outline-none" tabIndex={-1}>
        {api.state === "offline" ? (
          <ErrorOverlay
            kind="known"
            title="Music Assistant isn’t reachable"
            message={
              api.error ??
              "Start the Music Assistant server (see todo-musicplayer.md), then retry."
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
