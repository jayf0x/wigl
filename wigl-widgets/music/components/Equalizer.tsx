import { cn } from "@/wigl/utils";

// The idle/active VU bars. Pure CSS animation (music.css) — `active` just
// toggles play-state so a paused player shows flat bars.
const DELAYS = [0, 180, 90, 300, 150, 240, 60];

export const Equalizer = ({
  bars = 5,
  active = true,
  className,
}: {
  bars?: number;
  active?: boolean;
  className?: string;
}) => (
  <span className={cn("music-eq", !active && "is-idle", className)} aria-hidden>
    {Array.from({ length: bars }, (_, i) => (
      <i key={DELAYS[i % DELAYS.length]} style={{ ["--d" as string]: `${DELAYS[i % DELAYS.length]}ms` }} />
    ))}
  </span>
);
