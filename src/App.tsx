import type { ComponentType, ErrorInfo, ReactNode } from "react";
import { Component, lazy, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Desktop } from "@/wigl";
import "./App.css";

// The full widget contract: a widget is a folder, src/widgets/<name>/index.tsx,
// with exactly one export — a default-exported component. Grid size/position
// are plain props on <Widget w h col row> (see wigl/widget.tsx), not a second
// export.
interface WidgetModule {
  default: ComponentType;
}

// Widgets are discovered by folder: src/widgets/<name>/index.tsx. The folder
// name becomes the widget id. No registry, no manifest, no App.tsx edit —
// adding a widget is adding a folder. Non-eager: each monitor window only
// pays the code-split cost of the widgets it actually mounts, not every
// widget in the repo (a monitor renders a subset, decided by saved layout).
const loaders = import.meta.glob<WidgetModule>("./widgets/*/index.tsx");
const widgets: Record<string, ComponentType> = {};
for (const [path, load] of Object.entries(loaders)) {
  const id = path.split("/")[2];

  // The glob does no validation of what a widget exports, so a typo would
  // silently fail (blank widget / default size) — checked once the chunk
  // actually loads, since that's the earliest point the module exists.
  widgets[id] = lazy(async (): Promise<{ default: ComponentType }> => {
    const mod = await load();
    if (!mod.default) {
      console.error(`[wigl] widget "${id}" has no default export — index.tsx must default-export its component`);
      return { default: () => null };
    }
    if ("gridConfig" in mod) {
      console.warn(
        `[wigl] widget "${id}" exports a top-level "gridConfig" — ignored. Pass size/position as props instead: <Widget w={3} h={4}>`,
      );
    }
    return { default: mod.default };
  });
}

// `WidgetErrorBoundary` (Desktop.tsx) only catches a crash inside one
// widget's own render — a crash in <Desktop> itself (layout/drag logic, a
// shared hook) is above that boundary and would otherwise blank the whole
// monitor window with nothing on screen to explain why. This is the
// window-level backstop: same idea, one level up.
class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[wigl] app crashed", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, fontSize: 12, color: "#fca5a5", fontFamily: "monospace" }}>
          wigl crashed: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

// Rust creates one `screen-<i>` window per monitor at launch (see lib.rs),
// hidden and click-through; each shows itself once its webview is mounted.
// "main" (tauri.conf.json) is just the bootstrap webview and renders nothing.
// On Wayland (GNOME's default compositor), Rust instead spawns a single
// normal "screen-0" window — desktop-overlay hints (positioning, always-
// below, always-on-top, click-through) aren't grantable/worth relying on
// there — so the frontend asks Rust which mode it's in rather than guessing
// from window flags.
const App = () => {
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
  return (
    <AppErrorBoundary>
      <Desktop widgets={widgets} monitorIndex={Number(label.split("-")[1]) || 0} windowed={windowed} />
    </AppErrorBoundary>
  );
};

export default App;
