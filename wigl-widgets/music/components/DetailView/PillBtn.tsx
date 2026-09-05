import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/wigl/utils";

export const PillBtn = ({
  onClick,
  children,
  tap,
}: {
  onClick: () => void;
  children: ReactNode;
  /** fires audio — add the click ring-pulse */
  tap?: boolean;
}) => (
  <Button
    variant="ghost"
    data-no-drag
    onClick={onClick}
    className={cn(
      "mx-press h-auto flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
      tap && "mx-tap",
    )}
  >
    {children}
  </Button>
);
