import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, useRef } from "react";
import { cn } from "@/wigl/utils";

/** A vertical, pointer-driven fader — a piece of gear, not a rotated
 * `<Slider>`. Theme tokens only, `data-no-drag` so it never drags the widget.
 * `onChange` fires continuously (throttle the expensive side-effect at the
 * call site via rAF/setTargetAtTime); `onCommit` fires once on release for the
 * debounced persist. `detent` draws a centre line and magnetically snaps. */
export const VFader = ({
  value,
  min,
  max,
  step = 1,
  detent,
  marks,
  label,
  display,
  onChange,
  onCommit,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  detent?: number;
  marks?: number[];
  label: string;
  display: string;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  className?: string;
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const span = max - min;
  const pct = ((value - min) / span) * 100;

  const valueFromEvent = (clientY: number) => {
    const el = trackRef.current;
    if (!el) return value;
    const r = el.getBoundingClientRect();
    const frac = 1 - Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    let v = min + frac * span;
    v = Math.round(v / step) * step;
    if (detent != null && Math.abs(v - detent) <= span * 0.04) v = detent;
    return clamp(v);
  };

  const onDown = (e: ReactPointerEvent) => {
    e.preventDefault(); // P3.2 — don't start a text selection on the drag
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    onChange(valueFromEvent(e.clientY));
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!dragging.current) return;
    onChange(valueFromEvent(e.clientY));
  };
  const onUp = (e: ReactPointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit?.(value);
  };
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
    if (!d) return;
    e.preventDefault();
    const v = clamp(Math.round((value + d) / step) * step);
    onChange(v);
    onCommit?.(v);
  };

  return (
    <div className={cn("mx-nodrag-select flex min-w-0 flex-col items-center gap-1", className)}>
      <span className="tabular-nums text-[9px] text-foreground/80">{display}</span>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: role=slider is on this element */}
      <div
        ref={trackRef}
        data-no-drag
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={display}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onKeyDown={onKey}
        className="relative min-h-14 w-6 flex-1 cursor-ns-resize touch-none select-none rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {/* rail */}
        <span className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-border" />
        {/* detent line */}
        {detent != null && (
          <span
            className="absolute left-1/2 h-px w-3 -translate-x-1/2 bg-foreground/40"
            style={{ bottom: `calc(${((detent - min) / span) * 100}% )` }}
          />
        )}
        {/* scale marks */}
        {marks?.map((m) => (
          <span
            key={m}
            className="absolute left-1/2 h-px w-1.5 -translate-x-[calc(50%+7px)] bg-border"
            style={{ bottom: `${((m - min) / span) * 100}%` }}
          />
        ))}
        {/* fill from detent (or bottom) to the cap */}
        <span
          className="absolute left-1/2 w-px -translate-x-1/2 bg-foreground"
          style={
            detent != null
              ? {
                  bottom: `${((Math.min(value, detent) - min) / span) * 100}%`,
                  top: `${((max - Math.max(value, detent)) / span) * 100}%`,
                }
              : { bottom: 0, top: `${((max - value) / span) * 100}%` }
          }
        />
        {/* cap */}
        <span
          className="absolute left-1/2 h-2.5 w-5 -translate-x-1/2 translate-y-1/2 rounded-[2px] border border-foreground bg-background shadow-sm"
          style={{ bottom: `${pct}%` }}
        >
          <span className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-foreground/70" />
        </span>
      </div>
      <span className="music-tag text-[8px] text-muted-foreground/70">{label}</span>
    </div>
  );
};
