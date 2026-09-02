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

function TooltipProvider({
  delay = 350,
  closeDelay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      delay={delay}
      closeDelay={closeDelay}
      {...props}
    />
  );
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
      <TooltipPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        className="isolate z-50"
      >
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
        <TooltipContent
          side={side}
          sideOffset={sideOffset}
          align={align}
          className={className}
        >
          {content}
        </TooltipContent>
      </TooltipRoot>
    </TooltipProvider>
  );
}

export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
};

/* TODO RESEARCH


Ha — this is basically the point where I tell you the secret: at this size, nobody publishes it as a package because copying 30 lines *is* the distribution model. The closest things that exist are daisyUI's `tooltip` component (a pure-CSS Tailwind plugin with `tooltip-left`/`tooltip-right` modifiers — real, but it brings the whole component library with it) and Tailwind Plus's paid tooltip examples (same idea behind a paywall). Otherwise, the ecosystem's answer to "tiny tooltip" is literally the snippet below, owned in your repo.

Since you only ever need "below, flush left or right," it collapses nicely — and dropping centered positioning actually eliminates the worst clipping case, since `left-0`/`right-0` pins the tooltip to the trigger's edge:

```tsx
import type * as React from "react";
import { cn } from "@/wigl/utils/index";

const POS = {
  left:  "top-full left-0  mt-1 origin-top-left",
  right: "top-full right-0 mt-1 origin-top-right",
} as const;

export function Tooltip({
  content,
  align = "left",
  className,
  children,
}: {
  content: React.ReactNode;
  align?: keyof typeof POS;
  className?: string;
  children: React.ReactElement;
}) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-popover px-2 py-1",
          "text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10",
          "opacity-0 scale-95 duration-100 transition-[opacity,scale]",
          "group-hover/tt:delay-150 group-focus-visible/tt:delay-150",   // ~150ms hover-intent on show
          "group-hover/tt:opacity-100 group-hover/tt:scale-100",
          "group-focus-visible/tt:opacity-100 group-focus-visible/tt:scale-100",
          POS[align],
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
```

Usage stays identical to your current one-liner:

```tsx
<Tooltip content="Previous track" align="right">
  <IconButton icon={SkipBack} />
</Tooltip>
```

What survived from the Base UI version: hover-intent delay (`delay-150` only while hovered, so hide is instant — matching your old `delay/closeDelay` semantics), focus-visible support, the zoom/fade entrance, `role="tooltip"`, and your `className` escape hatch. What died: the Portal, collision flipping, and ~10kB of runtime.

Two honest caveats. First, focus-visible only works if `children` is actually focusable (your `<button/>` triggers are, so fine). Second, a parent with `overflow-hidden` between the trigger and the viewport edge will still clip it — if that bites you in a scroll container somewhere, that's the one case where I'd fall back to a Portal-based solution for that single instance, not globally.

Worth noting you can't fully replicate `aria-describedby` wiring statically — if screen-reader announcements matter for these tooltips, either duplicate the label on the trigger via `aria-label` (usually fine for icon buttons, since the tooltip text *is* the accessible name) or reconsider. For icon-button hints, `aria-label` on the trigger covers it and is arguably cleaner than what Base UI does.



*/
