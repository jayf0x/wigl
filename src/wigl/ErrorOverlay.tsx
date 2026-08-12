import { AlertTriangle, RotateCw, ShieldAlert } from "lucide-react";
import { cn } from "@/wigl/utils";

/** A widget's shared "something is broken" surface (backlog.md's F1) — one
 * place to show a real, current error condition instead of an ad-hoc
 * per-widget banner. `kind: "known"` is for an explainable cause the widget
 * already recognized (a backing process isn't running, a request failed for
 * a specific reason); `kind: "unknown"` is an unexpected/uncaught failure —
 * the two get a distinct icon/tone so a user can tell "this is a known
 * situation" from "something actually broke". */
export const ErrorOverlay = ({
  kind,
  title,
  message,
  onRetry,
  className,
}: {
  kind: "known" | "unknown";
  title: string;
  message?: string;
  /** Shown as a retry button when provided — omit if there's nothing to retry. */
  onRetry?: () => void;
  className?: string;
}) => (
  <div
    className={cn(
      "flex flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center",
      className,
    )}
  >
    {kind === "known" ? (
      <ShieldAlert className="size-6 text-muted-foreground" />
    ) : (
      <AlertTriangle className="size-6 text-destructive" />
    )}
    <p className="font-medium text-foreground/90 text-xs">{title}</p>
    {message && <p className="max-w-xs text-[11px] text-muted-foreground">{message}</p>}
    {onRetry && (
      <button
        type="button"
        data-no-drag
        onClick={onRetry}
        className="mt-1 flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground/80 transition-colors duration-150 hover:bg-muted"
      >
        <RotateCw className="size-3" />
        retry
      </button>
    )}
  </div>
);
