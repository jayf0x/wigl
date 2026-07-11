import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { WidgetModule } from "@/wigl";
import "./App.css";

// Widgets are discovered by folder: src/widgets/<name>/index.tsx. The folder
// name becomes the window label. No registry, no manifest, no App.tsx edit —
// adding a widget is adding a folder.
const modules = import.meta.glob<WidgetModule>("./widgets/*/index.tsx", { eager: true });
const widgets: Record<string, WidgetModule> = {};
for (const [path, mod] of Object.entries(modules)) {
  widgets[path.split("/")[2]] = mod;
}

// The hidden "main" window (the only one in tauri.conf.json) runs this once
// at launch, opening one OS window per widget folder. Window flags are the
// app's standard chrome; per-widget size/position comes from the widget's
// own optional `windowConfig` export.
let spawned = false;
function spawnWidgetWindows() {
  if (spawned) return; // StrictMode double-invokes effects in dev
  spawned = true;
  Object.entries(widgets).forEach(([name, mod], i) => {
    const cfg = mod.windowConfig ?? {};
    const win = new WebviewWindow(name, {
      url: "index.html",
      title: cfg.title ?? `wigl — ${name}`,
      width: cfg.width ?? 260,
      height: cfg.height ?? 320,
      x: cfg.x ?? 40 + i * 300,
      y: cfg.y ?? 40,
      transparent: true,
      decorations: false,
      shadow: false,
      alwaysOnBottom: true,
      skipTaskbar: true,
      resizable: false,
    });
    win.once("tauri://error", (e) => console.error(`[wigl] failed to open widget window "${name}"`, e));
  });
}

function App() {
  const label = getCurrentWindow().label;
  useEffect(() => {
    if (label === "main") spawnWidgetWindows();
  }, [label]);
  if (label === "main") return null;
  const Widget = widgets[label]?.default;
  return Widget ? <Widget /> : null;
}

export default App;
