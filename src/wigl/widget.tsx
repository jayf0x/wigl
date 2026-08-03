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
  /** Skip this widget entirely: not rendered, not reflowed, not hit-tested. */
  hidden?: boolean;
}

export interface WidgetGridReport {
  w: number;
  h: number;
  col?: number;
  row?: number;
  hidden?: boolean;
}

/** Desktop.tsx provides one of these per widget instance so <Widget> can
 * report its own grid size/position — the layout engine needs it before it
 * can arrange widgets, but a widget's size is only knowable once it renders. */
const WidgetSlotContext = createContext<((report: WidgetGridReport) => void) | null>(null);
export const WidgetSlotProvider = WidgetSlotContext.Provider;

/** TypeScript can't express "this component's root must be <Widget>" — that's
 * a JSX-tree shape, not a type. This is the runtime equivalent: <Widget> sets
 * it, <WidgetHeader> (and any future widget-only child) reads it and throws
 * immediately if it's missing, same pattern Radix/coss ui use for
 * Trigger-needs-Root. Fails loud in dev right where the mistake was made,
 * instead of a silently broken drag handle. */
const InsideWidgetContext = createContext(false);

const useRequireInsideWidget = (component: string) => {
  if (!useContext(InsideWidgetContext)) {
    throw new Error(`<${component}> must be rendered inside <Widget>`);
  }
};

// The `dark` class is required: coss ui components read colors from CSS
// variables scoped to :root/.dark in App.css.
export const Widget = ({
  className,
  children,
  w = TILING.defaultSize.w,
  h = TILING.defaultSize.h,
  col,
  row,
  hidden,
}: { className?: string; children: ReactNode } & WidgetGridProps) => {
  const report = useContext(WidgetSlotContext);
  // Layout effect, not a plain effect: this must resolve (and Desktop must
  // reflow) before the browser paints, or the placeholder size flashes.
  useLayoutEffect(() => {
    report?.({ w, h, col, row, hidden });
  }, [report, w, h, col, row, hidden]);

  return (
    // data-wigl-widget marks the root every widget must render through —
    // `plugin:check` greps built plugins for it so a folder that default-
    // exports some other component (not wrapped in <Widget>) fails the
    // build instead of silently never reporting a grid size.
    <InsideWidgetContext.Provider value>
      <div
        data-wigl-widget
        className={cn(
          "dark flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card/90 font-mono text-card-foreground backdrop-blur-xl",
          className,
        )}
      >
        {children}
      </div>
    </InsideWidgetContext.Provider>
  );
};

// data-drag-handle is what the tiling Desktop looks for on pointerdown:
// anything inside it drags the widget, except interactive elements and
// anything marked data-no-drag (Desktop filters those).
export const WidgetHeader = ({ className, children }: { className?: string; children?: ReactNode }) => {
  useRequireInsideWidget("WidgetHeader");
  return (
    <div
      data-drag-handle
      className={cn("flex cursor-grab items-center border-b border-border px-2 py-1 active:cursor-grabbing", className)}
    >
      {children}
    </div>
  );
};
