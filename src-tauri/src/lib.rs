#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // "main" is the hidden bootstrap window that spawns widget windows —
        // never save/restore its state, or a stale entry can resize it and
        // make it visible (an invisible click-eating rectangle).
        // Widgets are non-resizable, so their size always comes from the
        // widget's own `windowConfig` in code — only persist drag position,
        // or a saved SIZE entry would silently pin a widget to a stale width
        // forever, ignoring code changes.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&["main"])
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
