import { createContext, type ReactNode, useContext, useLayoutEffect } from "react";
import { cn } from "@/wigl/utils";
import { TILING } from "./grid/config";

/** All values are grid cells. `col`/`row` are only a first-launch hint —
 * ignored once the tiling desktop has a saved position (dragging always wins). */
export interface WidgetGridProps {
  w?: number;
  h?: number;
  col?: number;
  row?: number;
}

export interface WidgetGridReport {
  w: number;
  h: number;
  col?: number;
  row?: number;
}

/** Desktop.tsx provides one of these per widget instance so <Widget> can
 * report its own grid size/position — the layout engine needs it before it
 * can arrange widgets, but a widget's size is only knowable once it renders. */
const WidgetSlotContext = createContext<((report: WidgetGridReport) => void) | null>(null);
export const WidgetSlotProvider = WidgetSlotContext.Provider;

// The `dark` class is required: coss ui components read colors from CSS
// variables scoped to :root/.dark in App.css.
export const Widget = ({
  className,
  children,
  w = TILING.defaultSize.w,
  h = TILING.defaultSize.h,
  col,
  row,
}: { className?: string; children: ReactNode } & WidgetGridProps) => {
  const report = useContext(WidgetSlotContext);
  // Layout effect, not a plain effect: this must resolve (and Desktop must
  // reflow) before the browser paints, or the placeholder size flashes.
  useLayoutEffect(() => {
    report?.({ w, h, col, row });
  }, [report, w, h, col, row]);

  return (
    <div
      className={cn(
        "dark flex h-full w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-black/80 font-mono text-white/85 backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </div>
  );
};

// data-drag-handle is what the tiling Desktop looks for on pointerdown:
// anything inside it drags the widget, except interactive elements and
// anything marked data-no-drag (Desktop filters those).
export const WidgetHeader = ({ className, children }: { className?: string; children?: ReactNode }) => (
  <div
    data-drag-handle
    className={cn("flex cursor-grab items-center border-b border-white/10 px-2 py-1 active:cursor-grabbing", className)}
  >
    {children}
  </div>
);
