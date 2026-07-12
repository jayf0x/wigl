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
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(HitRects::default())
        .manage(DragActive::default())
        .invoke_handler(tauri::generate_handler![set_hit_rects, set_drag_active])
        .setup(|app| {
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
