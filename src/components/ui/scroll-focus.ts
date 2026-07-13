import { useEffect, useRef } from "react";

function getScrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (/auto|scroll/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Continuously sets a `--focus` (0..1) custom property on each `.scroll-focus`
 * child: 1 at the vertical center of the nearest scrollable ancestor, easing
 * to 0 at its edges (smoothstep falloff). CSS in App.css maps `--focus` to
 * opacity/filter/scale — see the `.scroll-focus` block there.
 *
 * JS-driven because WKWebView (Tauri/macOS) lacks scroll-driven animations;
 * one rAF-throttled listener writes one custom property per row per frame,
 * everything else (the actual styling) stays in CSS. Distances are
 * normalized to the container height, so it adapts to any widget size.
 * No-ops when the container doesn't scroll — rows keep their default look.
 */
export function useScrollFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    let scroller = getScrollParent(container);
    let raf = 0;

    function update() {
      raf = 0;
      // Content can grow after mount (async data) — pick up the scroller late.
      scroller ??= getScrollParent(container!);
      if (!scroller) return;
      const viewport = scroller.getBoundingClientRect();
      const center = viewport.top + viewport.height / 2;
      const half = viewport.height / 2 || 1;

      for (const el of container!.children) {
        if (!(el instanceof HTMLElement) || !el.classList.contains("scroll-focus")) continue;
        const r = el.getBoundingClientRect();
        const t = Math.max(0, 1 - Math.abs(r.top + r.height / 2 - center) / half);
        const eased = t * t * (3 - 2 * t); // smoothstep: gentle at edges and center
        el.style.setProperty("--focus", eased.toFixed(3));
      }
    }

    function schedule() {
      if (!raf) raf = requestAnimationFrame(update);
    }

    schedule();
    // Capture-phase on window: catches scrolls of whichever ancestor scrolls,
    // even if the scroller only becomes scrollable after data loads.
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(container);
    const mo = new MutationObserver(schedule); // rows added/removed/reordered
    mo.observe(container, { childList: true });

    return () => {
      window.removeEventListener("scroll", schedule, { capture: true });
      ro.disconnect();
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return ref;
}
