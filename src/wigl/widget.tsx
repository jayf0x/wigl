import type { ReactNode } from "react";
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

// data-drag-handle is what the tiling Desktop looks for on pointerdown:
// anything inside it drags the widget, except interactive elements and
// anything marked data-no-drag (Desktop filters those).
export function WidgetHeader({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div
      data-drag-handle
      className={cn(
        "flex cursor-grab items-center border-b border-white/10 px-2 py-1 active:cursor-grabbing",
        className,
      )}
    >
      {children}
    </div>
  );
}
