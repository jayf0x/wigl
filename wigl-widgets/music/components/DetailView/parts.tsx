import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <p className="music-tag px-2 pt-3 pb-1 text-muted-foreground/70">{children}</p>
);

export const Loading = () => (
  <div className="flex flex-1 items-center justify-center py-10 text-muted-foreground">
    <LoaderCircle className="size-4 animate-spin" />
  </div>
);
