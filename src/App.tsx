import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
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
// On Wayland (GNOME's default compositor), Rust instead spawns a single
// normal "screen-0" window — desktop-overlay hints (positioning, always-
// below, always-on-top, click-through) aren't grantable/worth relying on
// there — so the frontend asks Rust which mode it's in rather than guessing
// from window flags.
function App() {
  const label = getCurrentWindow().label;
  // Starts false (overlay's default) rather than null-until-resolved: if the
  // is_windowed_mode round-trip is ever slow or fails, the window still
  // shows and renders immediately instead of staying blank indefinitely.
  const [windowed, setWindowed] = useState(false);
  useEffect(() => {
    if (label !== "main") getCurrentWindow().show().catch(console.error);
  }, [label]);
  useEffect(() => {
    if (label === "main") return;
    invoke<boolean>("is_windowed_mode")
      .then((w) => {
        setWindowed(w);
        document.documentElement.classList.toggle("wigl-windowed", w);
      })
      .catch(console.error);
  }, [label]);
  if (label === "main") return null;
  return <Desktop widgets={widgets} monitorIndex={Number(label.split("-")[1]) || 0} windowed={windowed} />;
}

export default App;
