// Click-through for the fullscreen desktop window: the webview reports the
// physical-pixel rects of every widget on the tiling grid (the whole screen
// while a drag is live). Rust watches the global cursor and flips
// set_ignore_cursor_events: cursor over a widget -> window interactive,
// cursor over the transparent remainder -> clicks fall through to the
// desktop. Watching is required because a window ignoring cursor events
// receives no enter/leave events at all.
//
// TWO WAYS TO WATCH, chosen once at start():
//  * macOS: event-driven. An NSEvent mouse-moved monitor (global for events
//    going to other apps/the desktop, local for events landing on our own
//    windows) runs `evaluate` per event, so an idle cursor costs ZERO
//    wakeups — on an app that runs 24/7 this is the point. A 2s safety-net
//    tick (`tick`, driven by lib.rs's monitor poller) re-evaluates anyway
//    and notices a silent monitor (see `check_monitor_alive`), falling back
//    to polling so a macOS permission/behaviour change degrades to "costs
//    more", never to "widgets unclickable".
//  * Everything else (Linux/X11), and the macOS fallback: a 30Hz poll thread.
//
// Either way `evaluate` is the only thing that touches windows, and it also
// re-runs whenever its inputs change without the cursor moving (hit-rects
// reported, drag ended).
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

#[cfg(target_os = "macos")]
use std::sync::atomic::AtomicU64;

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
    /// True once the 30Hz poll thread is running (the default watcher off
    /// macOS, or the macOS fallback) — guards against starting it twice.
    polling: AtomicBool,
    /// macOS: mouse events the NSEvent monitors have delivered, and what the
    /// safety-net tick saw last time — see `check_monitor_alive`.
    #[cfg(target_os = "macos")]
    events: AtomicU64,
    #[cfg(target_os = "macos")]
    health: Mutex<Health>,
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct Health {
    last_pos: Option<(f64, f64)>,
    last_events: u64,
    strikes: u32,
}

// Both commands change `evaluate`'s inputs without the cursor moving (a widget
// resized/moved under a stationary cursor; a drag ending), so event-driven
// mode must re-run it here — nothing else would.
#[tauri::command]
pub fn set_hit_rects(app: tauri::AppHandle, window: tauri::Window, state: tauri::State<CursorState>, rects: Vec<Rect>) {
    state.rects.lock().unwrap().insert(window.label().into(), rects);
    evaluate_on_main(&app);
}

#[tauri::command]
pub fn set_drag_active(app: tauri::AppHandle, state: tauri::State<CursorState>, active: bool) {
    state.drag_active.store(active, Ordering::Relaxed);
    if !active {
        evaluate_on_main(&app);
    }
}

fn evaluate_on_main(app: &tauri::AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || evaluate(&handle));
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
    // try_lock = re-entrancy guard: if flipping click-through ever dispatches
    // a mouse event synchronously into our own monitor, the nested call must
    // bail out instead of deadlocking on the locks the outer pass holds.
    // (`windows` first: the nested call would otherwise block on `rects`.)
    let Ok(mut windows) = state.windows.try_lock() else { return };
    let Ok(cursor) = app.cursor_position() else { return };
    let rects = state.rects.lock().unwrap();
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
    if app.state::<CursorState>().polling.swap(true, Ordering::Relaxed) {
        return;
    }
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(33)); // ponytail: 30Hz poll, raise if hover feels laggy
        if app.state::<CursorState>().drag_active.load(Ordering::Relaxed) {
            continue;
        }
        evaluate_on_main(&app);
    });
}

/// Starts watching the cursor (overlay mode only). MAIN THREAD (setup()).
pub fn start(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    if install_mouse_monitors(app) {
        return;
    }
    spawn_poller(app.clone());
}

/// The 2s safety net (lib.rs's monitor poller calls this on the main
/// thread): re-run the hit-test in case an input change slipped past every
/// event-driven trigger, and check the event source is still alive.
pub fn tick(app: &tauri::AppHandle) {
    evaluate(app);
    #[cfg(target_os = "macos")]
    check_monitor_alive(app);
}

#[cfg(target_os = "macos")]
fn install_mouse_monitors(app: &tauri::AppHandle) -> bool {
    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask};
    use std::ptr::NonNull;

    // Moves, plus drags (a button held while moving generates *Dragged, not
    // MouseMoved) — the poll this replaces flipped state during those too.
    let mask = NSEventMask::MouseMoved
        | NSEventMask::LeftMouseDragged
        | NSEventMask::RightMouseDragged
        | NSEventMask::OtherMouseDragged;

    // One log line the first time each monitor delivers, so "is the
    // event-driven path actually live?" is answerable from the app log.
    let (seen_global, seen_local) = (AtomicBool::new(false), AtomicBool::new(false));
    let handle = app.clone();
    let global = RcBlock::new(move |_: NonNull<NSEvent>| {
        if !seen_global.swap(true, Ordering::Relaxed) {
            eprintln!("[wigl] cursor: global mouse monitor delivering events");
        }
        handle.state::<CursorState>().events.fetch_add(1, Ordering::Relaxed);
        evaluate(&handle);
    });
    let handle = app.clone();
    let local = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        if !seen_local.swap(true, Ordering::Relaxed) {
            eprintln!("[wigl] cursor: local mouse monitor delivering events");
        }
        handle.state::<CursorState>().events.fetch_add(1, Ordering::Relaxed);
        evaluate(&handle);
        event.as_ptr() // pass the event on untouched
    });

    eprintln!("[wigl] cursor: event-driven (NSEvent monitors)");
    // Both callbacks run on the main thread (AppKit delivers monitors there).
    let g = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &global);
    // SAFETY: the block returns the event it was given, a valid non-null pointer.
    let l = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &local) };
    if g.is_none() || l.is_none() {
        eprintln!("[wigl] NSEvent mouse monitors unavailable; polling the cursor instead");
        return false;
    }
    // Monitors live for the process; AppKit retains the blocks, we retain the tokens.
    std::mem::forget((g, l, global, local));
    true
}

/// A global NSEvent monitor can be silently inert (macOS gates some event
/// classes behind privacy permissions and has changed which). If the cursor
/// keeps moving between safety-net ticks but no monitor event arrived, the
/// event-driven path is dead — fall back to polling rather than leave
/// widgets unclickable. Two consecutive strikes, so one cursor warp doesn't
/// (the warp case only costs us the cheaper mode, never correctness).
#[cfg(target_os = "macos")]
fn check_monitor_alive(app: &tauri::AppHandle) {
    let state = app.state::<CursorState>();
    if state.polling.load(Ordering::Relaxed) {
        return;
    }
    let Ok(pos) = app.cursor_position() else { return };
    let pos = (pos.x, pos.y);
    let events = state.events.load(Ordering::Relaxed);
    let mut h = state.health.lock().unwrap();
    let moved = h.last_pos.is_some_and(|p| p != pos);
    if events != h.last_events {
        h.strikes = 0;
    } else if moved {
        h.strikes += 1;
    }
    h.last_pos = Some(pos);
    h.last_events = events;
    if h.strikes >= 2 {
        eprintln!("[wigl] mouse monitors silent while the cursor moves; polling the cursor instead");
        drop(h);
        spawn_poller(app.clone());
    }
}
