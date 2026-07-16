use std::{
    collections::HashMap,
    sync::atomic::{AtomicBool, Ordering},
    sync::Mutex,
    thread,
    time::Duration,
};
use tauri::Manager;

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
// honor but GNOME's Wayland compositor mostly refuses to grant a client
// (no absolute positioning, no always-below, no click-through-by-region).
// Rather than fight that, Wayland sessions get a normal single app window
// instead — same widgets, same grid/drag engine, just not glued to the
// desktop. `WIGL_MODE=windowed`/`overlay` overrides the auto-detection for
// anyone who wants the windowed flow on macOS or X11 too.
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
            is_windowed_mode
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
                // Single normal window: decorated, resizable, opaque, in the
                // taskbar — a regular app, not a desktop overlay. Same
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

            // One fullscreen transparent window per monitor, ordered
            // left-to-right so `screen-<i>` labels match the JS-side monitor
            // ids. Windows start hidden and click-through; each webview shows
            // itself once mounted, and the poller manages clicks from there.
            let mut monitors: Vec<_> = app.available_monitors()?;
            monitors.sort_by_key(|m| (m.position().x, m.position().y));
            for (i, mon) in monitors.iter().enumerate() {
                let s = mon.scale_factor();
                let pos = mon.position().to_logical::<f64>(s);
                let size = mon.size().to_logical::<f64>(s);
                let win = tauri::WebviewWindowBuilder::new(
                    app,
                    format!("screen-{i}"),
                    tauri::WebviewUrl::App("index.html".into()),
                )
                .title(format!("wigl — screen {i}"))
                .position(pos.x, pos.y)
                // 1px shorter than the monitor: a borderless window sized
                // exactly to the screen is treated as fullscreen by AppKit
                // and loses its transparency.
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
            spawn_cursor_poller(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
