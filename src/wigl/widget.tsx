import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
} from "react";
import { cn } from "@/wigl/utils";
import { CircleX, Expand, Grip, Minimize2 } from "lucide-react";
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

/** Desktop.tsx provides one of these per widget instance: the report callback
 * <Widget> needs to hand back its size before the layout engine can arrange
 * it, plus the desktop-owned close/minimize state and the actions that flip
 * it — both driven from outside the widget (the header buttons, or the
 * right-click menu's "closed widgets" section), not something a widget
 * tracks itself. */
export interface WidgetSlotValue {
  report: (report: WidgetGridReport) => void;
  minimized: boolean;
  onClose: () => void;
  onToggleMinimize: () => void;
}
const WidgetSlotContext = createContext<WidgetSlotValue | null>(null);
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
  hidden,
  minimizedIcon = null,
  headerContent = null,
}: {
  className?: string;
  children: ReactNode;
  minimizedIcon?: ReactNode;
  headerContent?: ReactNode;
} & WidgetGridProps) => {
  const slot = useContext(WidgetSlotContext);
  const minimized = !!slot?.minimized;
  // Layout effect, not a plain effect: this must resolve (and Desktop must
  // reflow) before the browser paints, or the placeholder size flashes.
  // Minimized forces a 1x1 report regardless of the widget's own w/h props —
  // un-minimizing just reports the real props again next render, and the
  // desktop's existing reflow puts it back where it fits.
  useLayoutEffect(() => {
    slot?.report({
      w: minimized ? 1 : w,
      h: minimized ? 1 : h,
      col,
      row,
      hidden,
    });
  }, [slot, minimized, w, h, col, row, hidden]);

  return (
    // data-wigl-widget marks the root every widget must render through —
    // `plugin:check` greps built plugins for it so a folder that default-
    // exports some other component (not wrapped in <Widget>) fails the
    // build instead of silently never reporting a grid size. Nothing below
    // <Widget> enforces its own placement at runtime (e.g. <WidgetHeader>
    // outside a <Widget>) — that's a widget author's own call to get wrong,
    // not a misuse worth guarding against.
    <div
      data-wigl-widget
      className={cn(
        "dark flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card/95 font-mono text-card-foreground",
        className,
      )}
    >
      {minimized ? (
        <div className="h-full w-full p-2">
          {/* <div className="flex h-5 w-full flex-row justify-between items-center">
            <button
              type="button"
              data-no-drag
              onClick={slot?.onToggleMinimize}
              title="Expand"
              className="p-1 text-card-foreground/40 hover:text-card-foreground"
            >
              <Expand className="size-3" />
            </button>

            <div
              data-drag-handle
              className="flex flex-1 items-center justify-center pb-1 text-lg leading-none text-card-foreground/70"
            >
              {":)"}
            </div>
          </div> */}

          <WidgetHeader>
            <div className="flex flex-1 items-center justify-center pb-1 text-lg leading-none text-card-foreground/70">
              {minimizedIcon ?? "◈"}
            </div>
          </WidgetHeader>
        </div>
      ) : (
        <>
          <WidgetHeader>{headerContent}</WidgetHeader>
          {children}
        </>
      )}
    </div>
  );
};

// data-widget-header is what Desktop's right-click handler looks for: the
// global-commands menu only fires from inside the header, so a right-click
// on a widget's own body (e.g. to paste into a textarea) gets the normal
// browser/webview context menu instead. Dragging is scoped even tighter —
// only the grip at the top-right corner carries data-drag-handle — so the
// rest of the header (close/minimize, title, custom buttons) is ordinary
// interactive/selectable content, and a future resize handle has somewhere
// (the opposite corner) to live without fighting drag.
const WidgetHeader = ({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) => {
  const slot = useContext(WidgetSlotContext);
  return (
    <div
      data-widget-header
      className={cn(
        "flex items-center gap-1 border-b border-border py-1 pr-1 pl-2",
        className,
      )}
    >
      <div className="mr-1 flex shrink-0 items-center gap-1 border-r border-border pr-2">
        <button
          type="button"
          onClick={slot?.onClose}
          title="Close"
          className="text-card-foreground/40 hover:text-destructive"
        >
          <CircleX className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={slot?.onToggleMinimize}
          title="Minimize"
          className="text-card-foreground/40 hover:text-card-foreground"
        >
          <Minimize2 className="size-3" />
        </button>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
      <div
        data-drag-handle
        title="Drag"
        className="flex size-6 shrink-0 cursor-grab items-center justify-center text-card-foreground/25 hover:text-card-foreground/50 active:cursor-grabbing"
      >
        <Grip className="size-3" />
      </div>
    </div>
  );
};
