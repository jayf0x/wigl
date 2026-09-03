import type * as React from "react";
import { cn } from "@/wigl/utils/index";

/** A minimal hover/focus tooltip — pure CSS, no Portal, no Base UI runtime.
 * Same shape as the other `ui/` components (owned code, `className`
 * passthrough, no prop-per-feature API).
 *
 * Positioning is edge-pinned, not centred/collision-flipped: the popup pins
 * to the trigger's left or right edge (`align`) and sits just below or above
 * it (`side`). This deliberately eliminates the worst clipping case. The one
 * remaining caveat: a parent with `overflow-hidden` between the trigger and
 * the viewport edge still clips it — fall back to a Portal for that single
 * instance if it ever bites.
 *
 * Accessibility: `role="tooltip"` on the popup, and the trigger must carry
 * its own accessible name (`aria-label` on icon buttons — the tooltip text
 * usually *is* that name). There is no static `aria-describedby` wiring.
 *
 * Focus-visible reveal only works when `children` is genuinely focusable
 * (all current triggers are `<button>`s). */

const POS = {
  "bottom-left": "top-full left-0 mt-1 origin-top-left",
  "bottom-right": "top-full right-0 mt-1 origin-top-right",
  "top-left": "bottom-full left-0 mb-1 origin-bottom-left",
  "top-right": "bottom-full right-0 mb-1 origin-bottom-right",
} as const;

function Tooltip({
  content,
  side = "bottom",
  align = "left",
  className,
  children,
}: {
  content: React.ReactNode;
  /** which edge of the trigger the popup sits against */
  side?: "top" | "bottom";
  /** which horizontal edge of the trigger the popup pins to */
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-popover px-2 py-1",
          "text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10",
          "scale-95 opacity-0 transition-[opacity,scale] duration-100",
          // ~150ms hover-intent on show; hide is instant
          "group-hover/tt:scale-100 group-hover/tt:opacity-100 group-hover/tt:delay-150",
          "group-focus-visible/tt:scale-100 group-focus-visible/tt:opacity-100 group-focus-visible/tt:delay-150",
          POS[`${side}-${align}` as keyof typeof POS],
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}

export { Tooltip };
