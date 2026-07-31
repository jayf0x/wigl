use std::{
    collections::HashMap,
    fs,
    sync::atomic::{AtomicBool, Ordering},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::{Emitter, Manager};

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
#[tauri::command]
fn is_windowed_mode() -> bool {
    windowed_mode()
}

fn windowed_mode() -> bool {
    match std::env::var("WIGL_MODE").as_deref() {
        Ok("windowed") => return true,
        Ok("overlay") => return false,
        _ => {}
    }
    if !cfg!(target_os = "linux") {
        return false;
    }
    // XDG_SESSION_TYPE is the documented signal, but some session managers
    // leave it unset or wrong (e.g. under certain display managers or when
    // launched from a non-login shell) — WAYLAND_DISPLAY is the socket a
    // Wayland client actually connects to, and is a more reliable fallback
    // signal than trusting XDG_SESSION_TYPE alone.
    let session_type_wayland = std::env::var("XDG_SESSION_TYPE").as_deref() == Ok("wayland");
    let has_wayland_display = std::env::var("WAYLAND_DISPLAY").map(|v| !v.is_empty()).unwrap_or(false);
    session_type_wayland || has_wayland_display
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
            let _ = w.set_ignore_cursor_events(true);
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
    thread::spawn(move || {
        let mut ignoring: HashMap<String, bool> = HashMap::new();
        loop {
            thread::sleep(Duration::from_millis(33)); // ponytail: 30Hz poll, raise if hover feels laggy
            if app.state::<DragActive>().0.load(Ordering::Relaxed) {
                continue;
            }
            let Ok(cursor) = app.cursor_position() else { continue };
            let rects = app.state::<HitRects>().0.lock().unwrap().clone();
            for (label, window) in app.webview_windows() {
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
    #[cfg(target_os = "linux")]
    if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(HitRects::default())
        .manage(DragActive::default())
        .invoke_handler(tauri::generate_handler![
            set_hit_rects,
            set_drag_active,
            is_windowed_mode,
            secrets_get,
            secrets_set
        ])
        .setup(|app| {
            let windowed = windowed_mode();
            eprintln!(
                "[wigl] mode: {} (WIGL_MODE={:?}, XDG_SESSION_TYPE={:?}, WAYLAND_DISPLAY={:?}, WEBKIT_DISABLE_DMABUF_RENDERER={:?})",
                if windowed { "windowed" } else { "overlay" },
                std::env::var("WIGL_MODE"),
                std::env::var("XDG_SESSION_TYPE"),
                std::env::var("WAYLAND_DISPLAY"),
                std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER"),
            );
            if windowed {
                // Single normal window: decorated, resizable, in the taskbar
                // — a regular app, not a desktop overlay. Kept lightly
                // transparent (see App.css's windowed-mode radial gradient)
                // purely as a soft visual touch, not to fake the overlay
                // flow's see-through-to-desktop look — that read as confusing
                // once click-through (see above) turned out not to be worth
                // keeping, since a transparent-looking area you can't click
                // through is worse than an honestly opaque one. Not setting
                // always_on_top either: same compositor-policy refusal as
                // always-below under GNOME/Wayland (not a client request
                // Mutter honors), and with no click-through to pair it with
                // there's nothing here that would benefit from it even where
                // it does work. Same widgets/grid, rendered as "screen-0" so
                // the frontend's existing monitorIndex parsing needs no
                // special case.
                let win = tauri::WebviewWindowBuilder::new(
                    app,
                    "screen-0",
                    tauri::WebviewUrl::App("index.html".into()),
                )
                .title("wigl")
                .inner_size(1100.0, 750.0)
                .visible(true)
                .resizable(true)
                .transparent(true)
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
