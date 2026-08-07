// The "info and toggles on bottom" strip from the original brief: opencode
// connection state (with a restart button once offline) and Ollama
// reachability (status only — see AGENTS.md for why start/stop isn't here
// yet). Deliberately not a settings panel — those live inline in Composer.
import { Circle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/wigl/utils";
import type { ServerStatus } from "../useOpencodeServer";

const StatusDot = ({ state }: { state: "on" | "off" | "pending" }) => (
  <Circle
    className={cn(
      "size-2",
      state === "on" && "fill-emerald-500 text-emerald-500",
      state === "off" && "fill-muted-foreground/40 text-muted-foreground/40",
      state === "pending" && "fill-amber-500 text-amber-500 animate-pulse",
    )}
  />
);

export const ServerStatusBar = ({
  opencodeStatus,
  ollamaOnline,
  onRestartOpencode,
}: {
  opencodeStatus: ServerStatus;
  ollamaOnline: boolean | null;
  onRestartOpencode: () => void;
}) => (
  <div className="flex items-center gap-3 border-border/60 border-t px-2 py-1 text-[10px] opacity-70">
    <div className="flex items-center gap-1">
      <StatusDot state={opencodeStatus === "online" ? "on" : opencodeStatus === "connecting" ? "pending" : "off"} />
      <span>opencode</span>
      {opencodeStatus === "offline" && (
        <Button size="icon-xs" variant="ghost" title="restart opencode server" onClick={onRestartOpencode}>
          <RotateCw className="size-2.5" />
        </Button>
      )}
    </div>
    <div className="flex items-center gap-1">
      <StatusDot state={ollamaOnline === null ? "pending" : ollamaOnline ? "on" : "off"} />
      <span className={cn(ollamaOnline === false && "opacity-50")}>ollama</span>
    </div>
  </div>
);
