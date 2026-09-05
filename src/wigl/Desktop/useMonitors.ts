import { useCallback, useEffect, useRef } from "react";
import { availableMonitors } from "@tauri-apps/api/window";
import type { MonitorRect } from "./types";

/** Every window derives the same ordered monitor list (left-to-right), so a
 * monitor's index is a shared, persistent id. `monitorsRef` is read
 * synchronously by drag's cross-monitor hit-testing, so it's a ref, not
 * state. The shell listens for `wigl-monitor-count` itself (it needs both
 * `refreshMonitors` from here and `setLayout` from useWidgetLayout, which in
 * turn needs `monitorsRef` from here — resolving that the other way around
 * would make the two hooks depend on each other). */
export const useMonitors = () => {
  const monitorsRef = useRef<MonitorRect[] | null>(null);

  const refreshMonitors = useCallback(
    () =>
      availableMonitors()
        .then((ms) => {
          monitorsRef.current = ms
            .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
            .map((m) => ({
              x: m.position.x / m.scaleFactor,
              y: m.position.y / m.scaleFactor,
              width: m.size.width / m.scaleFactor,
              height: m.size.height / m.scaleFactor,
            }));
        })
        .catch(console.error),
    [],
  );
  useEffect(() => {
    refreshMonitors();
  }, [refreshMonitors]);

  return { monitorsRef, refreshMonitors };
};
