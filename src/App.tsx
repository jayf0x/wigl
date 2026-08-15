import type { ComponentType, ErrorInfo, ReactNode } from "react";
import { Component, useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Desktop } from "@/wigl";
import { useRegisterGlobalAction } from "@/wigl/hooks";
import { type FailedPlugin, loadPlugins } from "@/wigl/plugins";
import "./App.css";

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
  // Null until widget discovery settles. <Desktop> is held back until then
  // deliberately: it builds its layout from the widget ids it's handed, and
  // handing it a set that grows a tick later is the same mount-order hazard
  // that already cost a first-launch layout bug once. Discovery is a couple
  // of `sh` reads, so the wait is imperceptible — and on failure it still
  // resolves (with an empty list) rather than hanging.
  const [widgets, setWidgets] = useState<Record<string, ComponentType> | null>(null);
  const [failedWidgets, setFailedWidgets] = useState<FailedPlugin[]>([]);

  useEffect(() => {
    if (label !== "main") getCurrentWindow().show().catch(console.error);
  }, [label]);

  // Shared by first mount, the manual "Reload widgets" menu entry, and the
  // cross-window broadcast below — `loadPlugins()` is idempotent (re-reads
  // disk, overwrites `__wigl_scopes__[id]`, dedupes injected styles), so
  // calling it again after `bun run widget:install` is enough to pick up a
  // rebuilt plugin without a full app relaunch.
  const reload = useCallback(() => {
    loadPlugins()
      .then(({ loaded, failed }) => {
        setWidgets(Object.fromEntries(loaded.map((p) => [p.manifest.id, p.component])));
        setFailedWidgets(failed);
      })
      .catch((e) => {
        console.error("[wigl] widget discovery failed", e);
        setWidgets({});
      });
  }, []);

  useEffect(() => {
    if (label === "main") return;
    reload();
  }, [label, reload]);

  // Reloading widgets is a per-window action (each monitor is its own JS
  // realm, see docs/architecture.md) — broadcast so triggering it on one
  // monitor reloads every monitor's widgets, not just the one under the
  // cursor.
  const reloadWidgetsAction = useMemo(
    () => ({
      id: "reload-widgets",
      label: "Reload widgets",
      run: () => {
        emit("wigl-reload-widgets").catch(console.error);
        reload();
      },
    }),
    [reload],
  );
  useRegisterGlobalAction(reloadWidgetsAction);

  useEffect(() => {
    if (label === "main") return;
    const un = listen("wigl-reload-widgets", reload);
    return () => {
      un.then((f) => f());
    };
  }, [label, reload]);

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
  if (!widgets) return null;
  return (
    <AppErrorBoundary>
      {failedWidgets.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-0 z-50 p-2 text-[11px] text-destructive">
          {failedWidgets.map((p) => (
            <div key={p.id}>
              widget "{p.id}" failed to load: {p.error}
            </div>
          ))}
        </div>
      )}
      <Desktop widgets={widgets} monitorIndex={Number(label.split("-")[1]) || 0} windowed={windowed} />
    </AppErrorBoundary>
  );
};

export default App;
