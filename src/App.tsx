import { useEffect } from "react";
import { PhysicalPosition, PhysicalSize, getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import { Desktop } from "@/wigl";
import type { WidgetModule } from "@/wigl";
import "./App.css";

// Widgets are discovered by folder: src/widgets/<name>/index.tsx. The folder
// name becomes the widget id. No registry, no manifest, no App.tsx edit —
// adding a widget is adding a folder.
const modules = import.meta.glob<WidgetModule>("./widgets/*/index.tsx", { eager: true });
const widgets: Record<string, WidgetModule> = {};
for (const [path, mod] of Object.entries(modules)) {
  widgets[path.split("/")[2]] = mod;
}

// One fullscreen transparent always-on-bottom window is the whole app; the
// Rust cursor poller makes everything outside a widget rect click-through.
// It starts hidden (tauri.conf.json) and is shown only after covering the
// monitor, so there's no flash of a small window.
async function coverPrimaryMonitor() {
  const win = getCurrentWindow();
  try {
    const monitor = await primaryMonitor();
    if (monitor) {
      await win.setPosition(new PhysicalPosition(monitor.position.x, monitor.position.y));
      // 1px shorter than the monitor: a borderless window sized exactly to the
      // screen is treated as fullscreen by AppKit and loses its transparency.
      await win.setSize(new PhysicalSize(monitor.size.width, monitor.size.height - 1));
    }
  } finally {
    await win.show();
  }
}

function App() {
  useEffect(() => {
    coverPrimaryMonitor().catch(console.error);
  }, []);
  return <Desktop widgets={widgets} />;
}

export default App;
