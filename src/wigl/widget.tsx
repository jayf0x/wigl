import type { ReactNode } from "react";
import { onDragHandleMouseDown } from "./drag";
import { cn } from "@/lib/utils";

// The `dark` class is required: coss ui components read colors from CSS
// variables scoped to :root/.dark in App.css.
export function Widget({ className, children }: { className?: string; children: ReactNode }) {
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
}

// Anything matching this inside the header keeps its own clicks; everything
// else starts a window drag. Add data-no-drag to opt out any custom element.
const INTERACTIVE = "button, a, input, select, textarea, [data-no-drag]";

// One job: make dragging and clicking coexist. Content and styling are the
// widget's own business — pass children, override looks via className.
export function WidgetHeader({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
        onDragHandleMouseDown(e);
      }}
      className={cn(
        "flex cursor-grab items-center border-b border-white/10 px-2 py-1 active:cursor-grabbing",
        className,
      )}
    >
      {children}
    </div>
  );
}
