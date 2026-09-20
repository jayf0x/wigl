// A collapsible list rail for widgets that hold a set of things (sessions,
// notes, …): <Sidebar> is the collapsing frame, <SidebarItem> one row with
// optional rename / confirm-delete built in, <SidebarAction> a hover icon for
// anything else (pin, copy, …). Children + className, like everything shared:
// what a row *means* stays in the widget.
//
// The frame collapses to zero width, not to an icon strip — an icon per item
// says nothing about which item it is — animating width so the neighbouring
// pane reflows instead of jumping. Width is the `--sb-w` var (default 13rem),
// set via className: `[--sb-w:11rem]`.
import { useState, type ReactNode } from "react";
import { Check, Loader2, type LucideIcon, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "./utils";

export const Sidebar = ({
  open,
  header,
  children,
  className,
}: {
  open: boolean;
  /** Pinned above the scrolling list (a label, a "new" button). */
  header?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex shrink-0 flex-col overflow-hidden border-border/60 transition-all duration-300 ease-out [--sb-w:13rem]",
      open ? "w-(--sb-w) border-r opacity-100" : "w-0 opacity-0",
      className,
    )}
  >
    {/* Inner blocks keep the open width even while the frame animates to 0. */}
    {header && <div className="w-(--sb-w) shrink-0">{header}</div>}
    <ScrollArea className="min-h-0 w-(--sb-w) flex-1">
      <div className="flex flex-col gap-px px-1.5 py-2">{children}</div>
    </ScrollArea>
  </div>
);

const hoverIcon = "hidden shrink-0 text-muted-foreground/60 hover:bg-transparent group-hover:block";

/** A hover-only icon button for a row's `actions` slot. Pass `className="block"`
 * to keep it visible at rest (a pinned item's pin). */
export const SidebarAction = ({
  icon: Icon,
  title,
  onClick,
  className,
}: {
  icon: LucideIcon;
  title: string;
  onClick: () => void;
  className?: string;
}) => (
  <Button
    type="button"
    variant="ghost"
    size="icon-xs"
    data-no-drag
    title={title}
    onClick={onClick}
    className={cn(hoverIcon, "hover:text-foreground", className)}
  >
    <Icon className="size-3" />
  </Button>
);

/** One row. Active = a left accent bar rather than a filled pill (same
 * signal, less noise in a list you're scanning). `onRename` enables
 * double-click / pencil rename in place; `onDelete` enables a trash icon that
 * confirms inline — native confirm() never shows over the always-on-bottom
 * overlay window — then shows a spinner while an async delete is in flight
 * (the row unmounts when the list updates). */
export const SidebarItem = ({
  title,
  meta,
  active,
  onSelect,
  onRename,
  onDelete,
  confirmText = "delete this?",
  actions,
}: {
  title: string;
  /** Right-aligned, hidden while the row is hovered (a timestamp). */
  meta?: ReactNode;
  active?: boolean;
  onSelect: () => void;
  onRename?: (title: string) => void;
  onDelete?: () => void | Promise<void>;
  confirmText?: string;
  /** Extra hover icons, shown between rename and delete. */
  actions?: ReactNode;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const runDelete = async () => {
    setDeleting(true);
    try {
      await onDelete?.();
    } catch {
      setDeleting(false);
      setConfirming(false);
    }
  };

  if (draft !== null)
    return (
      <input
        data-no-drag
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim()) onRename?.(draft.trim());
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(null);
        }}
        className="w-full rounded-md border border-ring/50 bg-background/50 px-2 py-1.5 text-[11px] outline-none"
      />
    );

  return (
    <div
      className={cn(
        // rounded-r-md, not rounded-md: a flat left accent bar, not a pill —
        // rounding the left corners made the bar itself look bulged.
        "group flex items-center gap-1.5 rounded-r-md border-l-2 px-2 py-1.5 text-[11px] transition-colors duration-150",
        confirming || deleting
          ? "border-destructive/60 bg-destructive/5 text-foreground"
          : active
            ? "border-primary bg-muted/50 text-foreground"
            : "border-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground",
      )}
    >
      {deleting ? (
        <>
          <Loader2 className="size-3 shrink-0 animate-spin text-destructive/70" />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">deleting…</span>
        </>
      ) : confirming ? (
        <>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{confirmText}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-no-drag
            title="confirm delete"
            onClick={runDelete}
            className="shrink-0 text-destructive/70 hover:bg-transparent hover:text-destructive"
          >
            <Check className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            data-no-drag
            title="cancel"
            onClick={() => setConfirming(false)}
            className="shrink-0 text-muted-foreground/60 hover:bg-transparent hover:text-foreground"
          >
            <X className="size-3.5" />
          </Button>
        </>
      ) : (
        <>
          {/* Plain click target blended into the row's own text — the row div
              carries the hover/active styling. check-style:allow-raw-button */}
          <button
            type="button"
            data-no-drag
            onClick={onSelect}
            onDoubleClick={onRename && (() => setDraft(title))}
            className="min-w-0 flex-1 truncate text-left"
          >
            {title}
          </button>
          {meta != null && <span className="shrink-0 text-[10px] text-muted-foreground/40 group-hover:hidden">{meta}</span>}
          {onRename && <SidebarAction icon={Pencil} title="rename" onClick={() => setDraft(title)} />}
          {actions}
          {onDelete && (
            <SidebarAction
              icon={Trash2}
              title="delete"
              onClick={() => setConfirming(true)}
              className="hover:text-destructive"
            />
          )}
        </>
      )}
    </div>
  );
};
