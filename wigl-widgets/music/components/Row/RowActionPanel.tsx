import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/wigl/utils";
import type { RowAction } from "./standardActions";

/** The fold-down pill strip: the full action list, with submenu + inline-input
 * support. Caller renders it conditionally on its own `open` state. */
export const RowActionPanel = ({
  actions,
  onClose,
  className,
  exclude,
}: {
  actions: RowAction[];
  onClose: () => void;
  className?: string;
  /** labels already shown as inline shortcuts on the row — dropped here so the
   * panel is pure overflow, never a duplicate (feedback F). */
  exclude?: string[];
}) => {
  const [sub, setSub] = useState<RowAction | null>(null);
  const [text, setText] = useState("");
  const list = actions.filter(
    (a) => !a.hidden && !(exclude?.includes(a.label) && a.run && !a.submenu),
  );
  const pills = sub?.submenu ? sub.submenu.filter((a) => !a.hidden) : list;
  const close = () => {
    setSub(null);
    setText("");
    onClose();
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-1 px-2 pt-1 pb-2", className)}>
      {sub && (
        <Button
          variant="ghost"
          data-no-drag
          onClick={() => {
            setSub(null);
            setText("");
          }}
          className="mx-press h-auto rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" /> back
        </Button>
      )}
      {sub?.input ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) sub.input?.onSubmit(text.trim());
            close();
          }}
        >
          {/* biome-ignore lint/a11y/noAutofocus: opens on an explicit user click */}
          <input
            data-no-drag
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={sub.input.placeholder}
            className="w-32 rounded border border-border bg-input/40 px-2 py-1 text-[10px] text-foreground outline-none placeholder:text-muted-foreground/60"
          />
          <Button
            type="submit"
            variant="ghost"
            data-no-drag
            className="mx-press h-auto rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            add
          </Button>
        </form>
      ) : (
        pills.map((a) => {
          const branch = !!(a.submenu || a.input);
          // Top-level plain actions collapse to an icon + hover/focus tooltip
          // on the whole button (P5.1); submenu contents (playlist names, radio
          // seeds) and any branch keep their text label — an icon alone
          // wouldn't name them.
          const iconOnly = !sub && !branch;
          const btn = (
            <Button
              key={a.label}
              variant="ghost"
              data-no-drag
              aria-label={a.label}
              onClick={() => {
                if (branch) setSub(a);
                else {
                  a.run?.();
                  close();
                }
              }}
              className={cn(
                "mx-press flex h-auto items-center gap-1.5 rounded border border-border text-[10px] transition-colors hover:bg-muted",
                iconOnly ? "p-1.5" : "px-2 py-1",
                a.danger
                  ? "text-muted-foreground hover:text-destructive"
                  : "text-muted-foreground hover:text-foreground",
                a.run && !branch && "mx-tap",
              )}
            >
              {a.icon}
              {!iconOnly && (
                <>
                  <span className="max-w-32 truncate">{a.label}</span>
                  {branch && <ChevronRight className="size-3" />}
                </>
              )}
            </Button>
          );
          return iconOnly ? (
            <Tooltip key={a.label} content={a.label}>
              {btn}
            </Tooltip>
          ) : (
            btn
          );
        })
      )}
    </div>
  );
};
