import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Desktop } from "@/wigl";
import type { WidgetModule } from "@/wigl";
import "./App.css";

// Widgets are discovered by folder: src/widgets/<name>/index.tsx. The folder
// name becomes the widget id. No registry, no manifest, no App.tsx edit —
// adding a widget is adding a folder.
const modules = import.meta.glob<WidgetModule>("./widgets/*/index.tsx", { eager: true });
const widgets: Record<string, WidgetModule> = {};
// The glob does no validation of what a widget exports, so a typo silently
// fails (blank widget / default size) — warn instead.
for (const [path, mod] of Object.entries(modules)) {
  const id = path.split("/")[2];
  if (!mod.default) {
    console.error(`[wigl] widget "${id}" has no default export — index.tsx must default-export its component`);
    continue;
  }
  if ("gridConfig" in mod) {
    console.warn(`[wigl] widget "${id}" exports a top-level "gridConfig" — ignored. Pass size/position as props instead: <Widget w={3} h={4}>`);
  }
  widgets[id] = mod;
}

// Rust creates one `screen-<i>` window per monitor at launch (see lib.rs),
// hidden and click-through; each shows itself once its webview is mounted.
// "main" (tauri.conf.json) is just the bootstrap webview and renders nothing.
function App() {
  const label = getCurrentWindow().label;
  useEffect(() => {
    if (label !== "main") getCurrentWindow().show().catch(console.error);
  }, [label]);
  if (label === "main") return null;
  return <Desktop widgets={widgets} monitorIndex={Number(label.split("-")[1]) || 0} />;
}

export default App;
