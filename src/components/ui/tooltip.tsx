import type * as React from "react";
import { cn } from "@/wigl/utils/index";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

/** A minimal hover/focus tooltip on the Base UI primitive — same shape as the
 * other `ui/` components (owned code, `className` passthrough, no
 * prop-per-feature API). `Tooltip` is a convenience wrapper for the common
 * "icon + short label" case; drop to the primitives for anything richer.
 *
 * `TooltipProvider` is optional — `Tooltip` renders its own so a single
 * tooltip works standalone; wrap a subtree in one `TooltipProvider` when you
 * want shared open-delay grouping. */

function TooltipProvider({ delay = 350, closeDelay = 0, ...props }: TooltipPrimitive.Provider.Props) {
  return <TooltipPrimitive.Provider delay={delay} closeDelay={closeDelay} {...props} />;
}

function TooltipRoot(props: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 6,
  align = "center",
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, "side" | "sideOffset" | "align">) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner side={side} sideOffset={sideOffset} align={align} className="isolate z-50">
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            "z-50 max-w-56 origin-(--transform-origin) rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

/** One-liner: `<Tooltip content="Previous track"><button …/></Tooltip>`. */
function Tooltip({
  content,
  children,
  side,
  sideOffset,
  align,
  className,
  delay,
  ...root
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  delay?: number;
} & Pick<TooltipPrimitive.Positioner.Props, "side" | "sideOffset" | "align"> &
  Omit<TooltipPrimitive.Root.Props, "children">) {
  return (
    <TooltipProvider delay={delay}>
      <TooltipRoot {...root}>
        <TooltipTrigger render={children as React.ReactElement} />
        <TooltipContent side={side} sideOffset={sideOffset} align={align} className={className}>
          {content}
        </TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger };
