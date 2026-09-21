// Click-through for the fullscreen desktop window: the webview reports the
// physical-pixel rects of every widget on the tiling grid (the whole screen
// while a drag is live). Rust watches the global cursor and flips
// set_ignore_cursor_events: cursor over a widget -> window interactive,
// cursor over the transparent remainder -> clicks fall through to the
// desktop. Watching is required because a window ignoring cursor events
// receives no enter/leave events at all.
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{Manager, WebviewWindow};

#[derive(serde::Deserialize, Clone, Copy)]
pub struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

struct Tracked {
    // Cloning a WebviewWindow allocates a CFRunLoopSource on macOS — doing
    // that for every window on every tick was most of the old poller's cost
    // in a profile, so handles are cached and cloned once per window.
    win: WebviewWindow,
    // What we last told the OS, so an unchanged answer costs no native call.
    ignoring: Option<bool>,
}

#[derive(Default)]
pub struct CursorState {
    /// Per-window widget rects (physical px), as reported by each webview.
    rects: Mutex<HashMap<String, Vec<Rect>>>,
    /// While a drag is live the hit-test pauses: flipping
    /// set_ignore_cursor_events mid-drag would sever the webview's pointer
    /// capture.
    drag_active: AtomicBool,
    /// Main-thread only (AppKit/GTK); a Mutex just to satisfy managed state.
    windows: Mutex<HashMap<String, Tracked>>,
}

#[tauri::command]
pub fn set_hit_rects(window: tauri::Window, state: tauri::State<CursorState>, rects: Vec<Rect>) {
    state.rects.lock().unwrap().insert(window.label().into(), rects);
}

#[tauri::command]
pub fn set_drag_active(state: tauri::State<CursorState>, active: bool) {
    state.drag_active.store(active, Ordering::Relaxed);
}

/// Drops a window's cached handle (it was closed). Safe from any thread.
pub fn forget_window(app: &tauri::AppHandle, label: &str) {
    app.state::<CursorState>().windows.lock().unwrap().remove(label);
}

/// One hit-test pass: cursor vs. every reporting window's widget rects, and
/// flip click-through where the answer changed. MAIN THREAD ONLY — GTK isn't
/// thread-safe and AppKit is main-thread-only; calling cursor_position /
/// outer_position / set_ignore_cursor_events from a worker thread corrupted
/// glibc's heap outright under concurrent webkit traffic (not a clean panic).
fn evaluate(app: &tauri::AppHandle) {
    let state = app.state::<CursorState>();
    if state.drag_active.load(Ordering::Relaxed) {
        return;
    }
    let Ok(cursor) = app.cursor_position() else { return };
    let rects = state.rects.lock().unwrap();
    let mut windows = state.windows.lock().unwrap();
    for (label, widget_rects) in rects.iter() {
        if !windows.contains_key(label) {
            let Some(win) = app.get_webview_window(label) else { continue };
            windows.insert(label.clone(), Tracked { win, ignoring: None });
        }
        let tracked = windows.get_mut(label).unwrap();
        let Ok(pos) = tracked.win.outer_position() else {
            windows.remove(label); // closed under us; refetched if it comes back
            continue;
        };
        let (lx, ly) = (cursor.x - pos.x as f64, cursor.y - pos.y as f64);
        let hit = widget_rects
            .iter()
            .any(|r| lx >= r.x && lx < r.x + r.w && ly >= r.y && ly < r.y + r.h);
        let want_ignore = !hit;
        if tracked.ignoring != Some(want_ignore) {
            if tracked.win.set_ignore_cursor_events(want_ignore).is_ok() {
                tracked.ignoring = Some(want_ignore);
            } else {
                windows.remove(label);
            }
        }
    }
}

fn spawn_poller(app: tauri::AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(33)); // ponytail: 30Hz poll, raise if hover feels laggy
        if app.state::<CursorState>().drag_active.load(Ordering::Relaxed) {
            continue;
        }
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || evaluate(&handle));
    });
}

/// Starts watching the cursor (overlay mode only).
pub fn start(app: &tauri::AppHandle) {
    spawn_poller(app.clone());
}
