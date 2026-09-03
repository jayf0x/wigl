import { Check, Play, RotateCw } from "lucide-react";
import { ErrorOverlay } from "@/wigl";
import { cn } from "@/wigl/utils";
import type { MusicApi } from "../useMusic";

/** P4 — shown when Music Assistant is unreachable. The shared `ErrorOverlay`
 * carries the "what's wrong" line; this adds the recovery controls the owner
 * wanted in-panel rather than buried in Settings: one "Start server" button
 * (which starts Docker too, if that's what's down), a plain retry, and the
 * auto-start toggle right beside them so the two never feel disconnected.
 * `onRetry` is handled here (not passed to ErrorOverlay) so the buttons can
 * wrap on a narrow tile. */
export const OfflinePanel = ({ api }: { api: MusicApi }) => (
  <ErrorOverlay
    kind="known"
    title="Music Assistant isn’t running"
    message={
      api.error ??
      "The local music server isn’t responding. Start it below, or turn on auto-start so it comes up on its own next time."
    }
  >
    <div className="flex flex-col items-center gap-2">
      <div className="flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        data-no-drag
        onClick={api.startServer}
        disabled={api.serverStarting}
        className={cn(
          "mx-press mx-tap flex items-center gap-1.5 rounded-md border border-foreground bg-foreground px-2.5 py-1 text-[11px] text-background transition-colors hover:bg-foreground/85 disabled:opacity-60",
          api.serverStarting && "mx-pending-long",
        )}
      >
        {api.serverStarting ? (
          <RotateCw className="size-3 animate-spin" />
        ) : (
          <Play className="size-3" fill="currentColor" />
        )}
        {api.serverStarting ? "starting…" : "Start server"}
      </button>

      <button
        type="button"
        data-no-drag
        onClick={api.retry}
        className="mx-press flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground/80 transition-colors hover:bg-muted"
      >
        <RotateCw className="size-3" />
        retry
      </button>
      </div>

      <button
        type="button"
        data-no-drag
        role="checkbox"
        aria-checked={api.manageServer}
        onClick={() => api.setManageServer(!api.manageServer)}
        className="mx-press flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <span
          className={cn(
            "grid size-3.5 place-items-center rounded-[3px] border border-border",
            api.manageServer && "border-foreground bg-foreground text-background",
          )}
        >
          {api.manageServer && <Check className="size-2.5" />}
        </span>
        Start automatically next time
      </button>
    </div>
  </ErrorOverlay>
);
