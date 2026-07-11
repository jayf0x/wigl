use std::{collections::HashMap, sync::Mutex, thread, time::Duration};
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

#[tauri::command]
fn set_hit_rects(window: tauri::Window, state: tauri::State<HitRects>, rects: Vec<Rect>) {
    state.0.lock().unwrap().insert(window.label().into(), rects);
}

fn spawn_cursor_poller(app: tauri::AppHandle) {
    thread::spawn(move || {
        let mut ignoring: HashMap<String, bool> = HashMap::new();
        loop {
            thread::sleep(Duration::from_millis(33)); // ponytail: 30Hz poll, raise if hover feels laggy
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
        .invoke_handler(tauri::generate_handler![set_hit_rects])
        .setup(|app| {
            // Start click-through: until the webview reports widget rects,
            // the (still hidden) fullscreen window must not eat desktop
            // clicks. The poller un-ignores once the cursor hits a widget.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_ignore_cursor_events(true);
            }
            spawn_cursor_poller(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
