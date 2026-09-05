import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/wigl/utils";

export const IconBtn = ({
  onClick,
  label,
  primary,
  active,
  disabled,
  pending,
  tap,
  tip = true,
  children,
}: {
  onClick: () => void;
  label: string;
  primary?: boolean;
  active?: boolean;
  disabled?: boolean;
  /** action is in flight — calm shimmer (mx-pending) */
  pending?: boolean;
  /** fires an async API call — click gets the mx-tap ring pulse */
  tap?: boolean;
  /** show `label` as a hover tooltip (ui/tooltip host component). On by
   * default (P5.2 — every transport control gets one); pass `tip={false}` to
   * suppress it for a control whose purpose is already obvious on screen. */
  tip?: boolean;
  children: ReactNode;
}) => {
  const btn = (
    <Button
      variant="ghost"
      data-no-drag
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "mx-press flex items-center justify-center rounded-full transition-colors disabled:opacity-40",
        tap && "mx-tap",
        pending && "mx-pending",
        primary
          ? "mx-icon-strong size-9 bg-foreground text-background hover:bg-foreground/85"
          : active
            ? "size-7 text-foreground hover:bg-transparent"
            : "size-7 text-muted-foreground hover:bg-transparent hover:text-foreground",
      )}
    >
      {children}
    </Button>
  );
  return tip ? (
    <Tooltip content={label} side="top">
      {btn}
    </Tooltip>
  ) : (
    btn
  );
};
