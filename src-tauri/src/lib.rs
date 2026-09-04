use std::{
    collections::HashMap,
    fs,
    sync::atomic::{AtomicBool, Ordering},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{Emitter, Manager};

mod pty;

// Secret/token storage: a widget needing an API key or OAuth token has
// nowhere else to put it (useStorage's sqlite kv is plaintext and synced
// across every window/poller). One JSON file in the app's data dir,
// chmod 600, atomic tmp-file+rename — no OS keychain crate, no
// cross-platform branching. This clears the "shell out unless truly
// impossible" bar in AGENTS.md: keeping the value out of shell argv/history
// while still doing atomic tmp+rename+chmod genuinely wants a native
// command instead of a shell one-liner.
const SECRETS_FILE: &str = "secrets.json";
// Names are used as JSON object keys only (never shell/SQL), but restrict
// them anyway so a stray "." or "/" can't be mistaken for a path.
fn valid_secret_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn secrets_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(SECRETS_FILE))
}

fn read_secrets(path: &std::path::Path) -> Result<HashMap<String, String>, String> {
    match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(e.to_string()),
    }
}

fn write_secrets(path: &std::path::Path, secrets: &HashMap<String, String>) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string(secrets).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
fn secrets_get(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    if !valid_secret_name(&name) {
        return Err(format!("invalid secret name: {name:?}"));
    }
    let path = secrets_path(&app)?;
    Ok(read_secrets(&path)?.get(&name).cloned())
}

#[tauri::command]
fn secrets_set(app: tauri::AppHandle, name: String, value: String) -> Result<(), String> {
    if !valid_secret_name(&name) {
        return Err(format!("invalid secret name: {name:?}"));
    }
    let path = secrets_path(&app)?;
    let mut secrets = read_secrets(&path)?;
    secrets.insert(name, value);
    write_secrets(&path, &secrets)
}

// Tier-2 settings (see todo-settings-ui.md's "Storage" section): a JSON file
// of *overrides* only, merged over each module's own compile-time defaults
// on the TS side (grid/config.ts's TILING, etc.) — this file mirrors
// secrets.json's atomic tmp-file+rename shape (same precedent, no chmod
// since nothing here is sensitive) rather than re-deciding that shape for a
// nearly-identical file. Restart-required by rule: nothing here is read
// again after startup, so there's no live-mutation path to get wrong.
const CONFIG_FILE: &str = "wigl-config.json";
const CONFIG_SCHEMA_FILE: &str = "wigl-config.schema.json";
// Editor-autocomplete only, same role as wigl-widgets/widget.schema.json —
// not runtime-validated by any code. Written once, at startup, if missing.
const CONFIG_SCHEMA: &str = r#"{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "wigl config overrides",
  "description": "Overrides for wigl's Tier-2 (restart-required) settings. Every field is optional — omit anything you want left at its built-in default. See grid/config.ts's TILING for what each grid field means.",
  "type": "object",
  "properties": {
    "grid": {
      "type": "object",
      "properties": {
        "cell": { "type": "number" },
        "gap": { "type": "number" },
        "padding": {
          "type": "object",
          "properties": {
            "top": { "type": "number" },
            "right": { "type": "number" },
            "bottom": { "type": "number" },
            "left": { "type": "number" }
          }
        },
        "cols": { "type": ["number", "null"] },
        "rows": { "type": ["number", "null"] }
      }
    },
    "app": {
      "type": "object",
      "properties": {
        "mode": {
          "type": "string",
          "description": "\"windowed\" or \"overlay\" — see windowed_mode() in lib.rs. Beaten by the WIGL_MODE env var when that's set; otherwise this is checked before the Linux/Wayland auto-detect fallback.",
          "enum": ["windowed", "overlay"]
        }
      }
    }
  }
}
"#;

fn config_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(CONFIG_FILE))
}

fn write_config_schema_if_missing(app: &tauri::AppHandle) {
    let Ok(dir) = app.path().app_data_dir() else { return };
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(CONFIG_SCHEMA_FILE);
    if !path.exists() {
        let _ = fs::write(&path, CONFIG_SCHEMA);
    }
}

#[tauri::command]
fn config_get(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = config_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn config_set(app: tauri::AppHandle, config: serde_json::Value) -> Result<(), String> {
    let path = config_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

// Click-through for the fullscreen desktop window: the webview reports the
// physical-pixel rects of every widget on the tiling grid (the whole screen
// while a drag is live). A Rust thread polls the global cursor and flips
// set_ignore_cursor_events: cursor over a widget -> window interactive,
// cursor over the transparent remainder -> clicks fall through to the
// desktop. Polling is required because a window ignoring cursor events
// receives no enter/leave events at all.
#[derive(serde::Deserialize, Clone, Copy)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Default)]
struct HitRects(Mutex<HashMap<String, Vec<Rect>>>);

// While a drag is live the poller pauses: flipping set_ignore_cursor_events
// mid-drag would sever the webview's pointer capture.
#[derive(Default)]
struct DragActive(AtomicBool);

#[tauri::command]
fn set_hit_rects(window: tauri::Window, state: tauri::State<HitRects>, rects: Vec<Rect>) {
    state.0.lock().unwrap().insert(window.label().into(), rects);
}

#[tauri::command]
fn set_drag_active(state: tauri::State<DragActive>, active: bool) {
    state.0.store(active, Ordering::Relaxed);
}

// Desktop-overlay mode (fullscreen, transparent, always-on-bottom,
// click-through) leans on window-manager hints that macOS/AppKit and X11
// honor but GNOME's Wayland compositor refuses to grant a client: no
// absolute positioning, no always-below (and always-on-top is the same
// compositor-policy refusal, not worth asking for either). Click-through was
// tried and reverted: it technically worked (Wayland does support
// per-surface cursor regions), but without always-below/always-on-top to
// keep this window out of the way, a click passing through empty grid space
// just focused whatever was stacked underneath — not the desktop — which
// made the app feel broken rather than widget-like. Rather than fight any of
// this, Wayland sessions get a normal single app window instead — same
// widgets, same grid/drag engine, just not glued to the desktop.
// `WIGL_MODE=windowed`/`overlay` overrides the auto-detection for anyone who
// wants the windowed flow on macOS or X11 too.
// `app: tauri::AppHandle` (rather than no args) lets this command's answer
// reflect a Tier-2 `app.mode` override the same way windowed_mode()'s other
// caller (setup(), which has an `&App` handy already) does — see F10 in
// backlog.md's history. AppHandle implements Manager same as App, so
// app_data_dir() resolves the same way in both places.
#[tauri::command]
fn is_windowed_mode(app: tauri::AppHandle) -> bool {
    windowed_mode(app.path().app_data_dir().ok().as_deref())
}

// `app_data_dir` is optional purely so callers that can't resolve one (there
// aren't any today, but a future headless/CLI-ish caller might) still get
// the env-var/Wayland precedence instead of being forced to fabricate a
// path. Both real call sites (is_windowed_mode above, setup() below) pass
// Some(..).
fn windowed_mode(app_data_dir: Option<&std::path::Path>) -> bool {
    match std::env::var("WIGL_MODE").as_deref() {
        Ok("windowed") => return true,
        Ok("overlay") => return false,
        _ => {}
    }
    if let Some(mode) = app_data_dir.and_then(config_mode_override) {
        return mode;
    }
    if !cfg!(target_os = "linux") {
        return false;
    }
    wayland_session()
}

// Reads wigl-config.json straight off disk with plain `fs` (same file
// config_get/config_set touch), not through the async config_get command:
// this runs inside setup(), before any webview/IPC exists to answer it. Any
// read/parse failure (missing file, corrupt JSON, no "app.mode" key) falls
// through to None so the caller moves on to its next precedence step rather
// than treating "no override" as an error.
fn config_mode_override(dir: &std::path::Path) -> Option<bool> {
    let s = fs::read_to_string(dir.join(CONFIG_FILE)).ok()?;
    let json: serde_json::Value = serde_json::from_str(&s).ok()?;
    parse_mode_override(&json)
}

// Split out from config_mode_override so the precedence logic itself (the
// part actually worth locking down) is a pure function with no fs/AppHandle
// dependency — see the #[test] below.
fn parse_mode_override(config: &serde_json::Value) -> Option<bool> {
    match config.get("app")?.get("mode")?.as_str()? {
        "windowed" => Some(true),
        "overlay" => Some(false),
        _ => None,
    }
}

#[cfg(test)]
mod mode_override_tests {
    use super::parse_mode_override;
    use serde_json::json;

    #[test]
    fn reads_windowed_and_overlay() {
        assert_eq!(parse_mode_override(&json!({"app": {"mode": "windowed"}})), Some(true));
        assert_eq!(parse_mode_override(&json!({"app": {"mode": "overlay"}})), Some(false));
    }

    #[test]
    fn none_when_absent_or_unrecognized() {
        assert_eq!(parse_mode_override(&json!({})), None);
        assert_eq!(parse_mode_override(&json!({"app": {}})), None);
        assert_eq!(parse_mode_override(&json!({"app": {"mode": "sideways"}})), None);
        assert_eq!(parse_mode_override(&json!({"grid": {"cell": 40}})), None);
    }
}

// Is this process talking to a Wayland compositor? Separate from
// windowed_mode() because WIGL_MODE can force the windowed *flow* on an X11
// session, while renderer workarounds have to key off the actual session.
//
// XDG_SESSION_TYPE is the documented signal, but some session managers leave
// it unset or wrong (e.g. under certain display managers or when launched
// from a non-login shell) — WAYLAND_DISPLAY is the socket a Wayland client
// actually connects to, and is a more reliable fallback signal than trusting
// XDG_SESSION_TYPE alone.
fn wayland_session() -> bool {
    let session_type_wayland = std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("wayland");
    let has_wayland_display = std::env::var("WAYLAND_DISPLAY").map(|v| !v.is_empty()).unwrap_or(false);
    session_type_wayland || has_wayland_display
}

// A system-tray icon whose menu is the app's always-available control
// surface — reachable with zero widgets open (the right-click global menu
// needs a widget header to land on) and in both window flows. The menu here
// is only a minimal fallback (Quit, always works even if JS never loads);
// the real menu is built and pushed from JS to mirror the same
// useGlobalActions registry the right-click menu renders — see
// src/wigl/menu/native.ts, which looks this icon up by TRAY_ID.
const TRAY_ID: &str = "wigl";

fn spawn_tray(app: &tauri::AppHandle) {
    use tauri::menu::MenuBuilder;
    use tauri::tray::TrayIconBuilder;

    let menu = match MenuBuilder::new(app).text("quit", "Quit wigl").build() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("[wigl] tray menu build failed: {e}");
            return;
        }
    };
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("wigl")
        .menu(&menu)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "quit" {
                app.exit(0);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    if let Err(e) = builder.build(app) {
        eprintln!("[wigl] tray icon build failed: {e}");
    }
}

// One fullscreen transparent window per monitor, ordered left-to-right so
// `screen-<i>` labels match the JS-side monitor ids. Windows start hidden
// and click-through; each webview shows itself once mounted, and the
// cursor poller manages clicks from there. Shared by initial setup() and
// spawn_monitor_poller() (new monitor plugged in after launch).
fn spawn_screen_window(app: &tauri::AppHandle, i: usize, mon: &tauri::Monitor) {
    let s = mon.scale_factor();
    let pos = mon.position().to_logical::<f64>(s);
    let size = mon.size().to_logical::<f64>(s);
    let win = tauri::WebviewWindowBuilder::new(app, format!("screen-{i}"), tauri::WebviewUrl::App("index.html".into()))
        .title(format!("wigl — screen {i}"))
        .position(pos.x, pos.y)
        // 1px shorter than the monitor: a borderless window sized exactly to
        // the screen is treated as fullscreen by AppKit and loses its
        // transparency.
        .inner_size(size.width, size.height - 1.0)
        .visible(false)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_bottom(true)
        .skip_taskbar(true)
        .resizable(false)
        .build();
    match win {
        Ok(w) => {
            // Skip on Linux: GTK queues this through the same
            // window_requests_tx channel spawn_cursor_poller uses, processed
            // by tao's event loop against the window's GdkWindow — which
            // doesn't exist until the window is realized (shown). Since this
            // window is built with .visible(false) and only shown later once
            // its webview mounts and calls show() over IPC, the GdkWindow is
            // still None when this queued request lands, and tao's handler
            // unwraps that None and aborts the whole process. macOS's AppKit
            // equivalent has no such realize precondition. No functional
            // loss from skipping it here: the window is invisible until
            // shown regardless, and spawn_cursor_poller (already running)
            // establishes the correct ignore/interactive state from the
            // first hit-rects report once the window is actually visible.
            #[cfg(not(target_os = "linux"))]
            let _ = w.set_ignore_cursor_events(true);
            #[cfg(target_os = "linux")]
            let _ = &w;
        }
        Err(e) => eprintln!("[wigl] failed to create screen-{i}: {e}"),
    }
}

// Tracks the monitor count spawn_monitor_poller last reconciled against —
// managed state so the periodic check (run on the main thread, see below)
// can read/update it.
struct MonitorCount(Mutex<usize>);

// available_monitors()/window creation/window close all bottom out in
// AppKit (NSScreen, NSWindow) on macOS, which is main-thread-only — calling
// them from a background thread is undefined behavior (this silently
// corrupted window creation during development: screen-0 stopped appearing
// at all). So the poll interval lives on a plain OS thread, but every
// AppKit-touching step is marshaled onto the main thread via
// run_on_main_thread.
fn reconcile_monitors(app: &tauri::AppHandle) {
    let Ok(mut monitors) = app.available_monitors() else { return };
    monitors.sort_by_key(|m| (m.position().x, m.position().y));
    let new_count = monitors.len();
    let state = app.state::<MonitorCount>();
    let mut count = state.0.lock().unwrap();
    if new_count == *count {
        return;
    }
    if new_count > *count {
        for (i, mon) in monitors.iter().enumerate().skip(*count) {
            spawn_screen_window(app, i, mon);
        }
    } else {
        for i in new_count..*count {
            if let Some(w) = app.get_webview_window(&format!("screen-{i}")) {
                let _ = w.close();
            }
        }
    }
    *count = new_count;
    let _ = app.emit("wigl-monitor-count", new_count);
}

// Polls available_monitors() (the only cross-platform monitor-change signal
// Tauri exposes) so plugging/unplugging a display doesn't need a relaunch.
// Treats monitor indices as append-only: a newly plugged monitor becomes the
// next index, and if the monitor count shrinks, the highest-indexed
// screen-<i> windows are assumed to be the ones that vanished and are
// closed. Reassigning those monitors' widgets back to monitor 0 is a
// frontend concern (widget_layout lives in sqlite, not Rust) — this just
// tells every window the new count via "wigl-monitor-count" and each
// Desktop reconciles its own saved positions against it.
fn spawn_monitor_poller(app: tauri::AppHandle) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(2)); // ponytail: 2s poll, cheap and nobody notices a 2s lag on a docking event
            let handle = app.clone();
            let _ = app.run_on_main_thread(move || reconcile_monitors(&handle));
        }
    });
}

fn spawn_cursor_poller(app: tauri::AppHandle) {
    // GTK isn't thread-safe: every call here (cursor_position, a window's
    // outer_position, set_ignore_cursor_events) has to land on the main
    // thread, same as spawn_monitor_poller's run_on_main_thread above. This
    // used to call them straight from the polling thread — usually got away
    // with it (tao does queue the request internally), but under enough
    // concurrent main-thread GTK/webkit traffic — e.g. dragging a widget,
    // which repaints heavily — the race corrupted glibc's heap outright
    // (`malloc(): smallbin double linked list corrupted`, not a clean Rust
    // panic). `ignoring` moves to an Arc<Mutex<_>> since the closure posted
    // to the main thread now outlives a single loop iteration on this one.
    let ignoring: Arc<Mutex<HashMap<String, bool>>> = Arc::new(Mutex::new(HashMap::new()));
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_millis(33)); // ponytail: 30Hz poll, raise if hover feels laggy
            if app.state::<DragActive>().0.load(Ordering::Relaxed) {
                continue;
            }
            let handle = app.clone();
            let ignoring = ignoring.clone();
            let _ = app.run_on_main_thread(move || {
                let Ok(cursor) = handle.cursor_position() else { return };
                let rects = handle.state::<HitRects>().0.lock().unwrap().clone();
                let mut ignoring = ignoring.lock().unwrap();
                for (label, window) in handle.webview_windows() {
                    let Some(widget_rects) = rects.get(&label) else { continue };
                    let Ok(pos) = window.outer_position() else { continue };
                    let (lx, ly) = (cursor.x - pos.x as f64, cursor.y - pos.y as f64);
                    let hit = widget_rects
                        .iter()
                        .any(|r| lx >= r.x && lx < r.x + r.w && ly >= r.y && ly < r.y + r.h);
                    let want_ignore = !hit;
                    if ignoring.get(&label) != Some(&want_ignore) {
                        if window.set_ignore_cursor_events(want_ignore).is_ok() {
                            ignoring.insert(label, want_ignore);
                        }
                    }
                }
            });
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK's DMA-BUF renderer (default since 2.42) is known to fail
    // silently on some GPU/driver/external-display/docking combinations
    // under Wayland: the window exists and the process runs fine, but
    // nothing ever actually paints. This is the standard workaround — set
    // before webkit2gtk initializes, and only if the user hasn't already
    // set it themselves (e.g. to debug/compare).
    //
    // Wayland only, deliberately. WebKitGTK removed its X11 accelerated
    // backing store, so on X11 this variable no longer means "use the other
    // accelerated path" — it means "fall off accelerated compositing
    // entirely". The software path then reports the *whole* window as
    // damaged on every frame instead of the rects that actually changed,
    // which is what the compositor re-uploads per frame. On a normal display
    // that's merely wasteful; on a fractionally-scaled 4K desktop (a
    // 6144x3456 framebuffer here, ~85 MB per surface) it can't keep up with
    // a drag, and the screen shows half-updated frames — the ghosting/
    // tearing tracked in todo-ghosting.md. X11 sessions never had the blank-
    // window problem this works around in the first place.
    #[cfg(target_os = "linux")]
    if wayland_session() && std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .manage(HitRects::default())
        .manage(DragActive::default())
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            set_hit_rects,
            set_drag_active,
            is_windowed_mode,
            secrets_get,
            secrets_set,
            config_get,
            config_set,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_read,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_exitstatus
        ])
        .setup(|app| {
            write_config_schema_if_missing(app.handle());
            let windowed = windowed_mode(app.path().app_data_dir().ok().as_deref());
            eprintln!(
                "[wigl] mode: {} (WIGL_MODE={:?}, XDG_SESSION_TYPE={:?}, WAYLAND_DISPLAY={:?}, WEBKIT_DISABLE_DMABUF_RENDERER={:?})",
                if windowed { "windowed" } else { "overlay" },
                std::env::var("WIGL_MODE"),
                std::env::var("XDG_SESSION_TYPE"),
                std::env::var("WAYLAND_DISPLAY"),
                std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER"),
            );
            spawn_tray(app.handle());

            if windowed {
                // Single normal window: decorated, resizable, in the taskbar
                // — a regular app, not a desktop overlay. Opaque, not
                // transparent: this used to carry a light `transparent(true)`
                // touch purely for looks (see App.css's windowed-mode radial
                // gradient), but WebKitGTK's accelerated compositing on a
                // transparent GTK window doesn't reliably clear the backing
                // store between paints — every widget drag left visible
                // ghosting/tearing on Linux (not reproducible on macOS,
                // where WKWebView's CALayer compositing doesn't have this
                // bug). Not worth keeping a decorative effect that breaks
                // the primary platform this mode exists for; App.css bakes
                // the same vignette look into fully-opaque gradient stops
                // instead. Not setting always_on_top either: same
                // compositor-policy refusal as always-below under
                // GNOME/Wayland (not a client request Mutter honors), and
                // with no click-through to pair it with there's nothing here
                // that would benefit from it even where it does work. Same
                // widgets/grid, rendered as "screen-0" so the frontend's
                // existing monitorIndex parsing needs no special case.
                let win = tauri::WebviewWindowBuilder::new(
                    app,
                    "screen-0",
                    tauri::WebviewUrl::App("index.html".into()),
                )
                .title("wigl")
                .inner_size(1100.0, 750.0)
                .visible(true)
                .resizable(true)
                .on_page_load(|_window, payload| {
                    eprintln!("[wigl] page load: {:?} {}", payload.event(), payload.url());
                })
                .build();
                match win {
                    Ok(w) => {
                        // Don't depend on the webview's JS finishing load/mount
                        // to call show() over IPC — under some WebKitGTK/Wayland
                        // combos that round-trip never completes and the window
                        // stays created-but-unmapped forever with nothing on
                        // screen. Showing directly from Rust right after build()
                        // removes that entire fragile chain as a precondition
                        // for the window even appearing.
                        if let Err(e) = w.show() {
                            eprintln!("[wigl] failed to show windowed app window: {e}");
                        }
                    }
                    Err(e) => eprintln!("[wigl] failed to create windowed app window: {e}"),
                }
                return Ok(());
            }

            let mut monitors: Vec<_> = app.available_monitors()?;
            // Seen empty on a clean checkout with displays physically connected
            // the whole time (backlog-documented) — the display server can lag
            // reporting monitors this early in Tauri's own startup. Short
            // bounded retry recovers from that timing race instead of silently
            // spawning zero screen-<i> windows.
            for attempt in 1..=10 {
                if !monitors.is_empty() {
                    break;
                }
                eprintln!("[wigl] available_monitors() returned empty (attempt {attempt}/10), retrying");
                std::thread::sleep(std::time::Duration::from_millis(200));
                monitors = app.available_monitors()?;
            }
            monitors.sort_by_key(|m| (m.position().x, m.position().y));
            for (i, mon) in monitors.iter().enumerate() {
                spawn_screen_window(app.handle(), i, mon);
            }
            app.manage(MonitorCount(Mutex::new(monitors.len())));
            spawn_cursor_poller(app.handle().clone());
            spawn_monitor_poller(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
