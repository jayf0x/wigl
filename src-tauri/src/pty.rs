// Real PTY backend for the terminal widget — vendored from
// github.com/Tnze/tauri-plugin-pty (MIT) as plain app commands rather than a
// Tauri plugin, same weight class as secrets_get/set in lib.rs: small,
// in-house, no capability-manifest ceremony for six commands only this app
// calls. Justified per docs/architecture.md's "shell out unless truly
// impossible" rule — an interactive session needs real tty semantics
// (cursor addressing, job control, correct COLUMNS/LINES) that
// tauri-plugin-shell's execute/spawn can't provide, and needs a stdin write
// path streaming output can't either. portable-pty picks the right native
// backend (unix pty / Windows ConPTY) per target at compile time, so this
// file has no #[cfg(windows)] branches of its own.
use std::{
    collections::BTreeMap,
    ffi::OsString,
    sync::atomic::{AtomicU32, Ordering},
};

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, PtyPair, PtySize};
use tauri::async_runtime::{Mutex, RwLock};

type PtyId = u32;

struct Session {
    pair: Mutex<PtyPair>,
    child: Mutex<Box<dyn Child + Send + Sync>>,
    child_killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    reader: Mutex<Box<dyn std::io::Read + Send>>,
}

#[derive(Default)]
pub struct PtyState {
    next_id: AtomicU32,
    sessions: RwLock<BTreeMap<PtyId, std::sync::Arc<Session>>>,
}

#[tauri::command]
pub async fn pty_spawn(
    file: String,
    args: Vec<String>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    env: BTreeMap<String, String>,
    state: tauri::State<'_, PtyState>,
) -> Result<PtyId, String> {
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(file);
    cmd.args(args);
    if let Some(cwd) = cwd {
        cmd.cwd(OsString::from(cwd));
    }
    for (k, v) in env.iter() {
        cmd.env(OsString::from(k), OsString::from(v));
    }
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let child_killer = child.clone_killer();

    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let session = std::sync::Arc::new(Session {
        pair: Mutex::new(pair),
        child: Mutex::new(child),
        child_killer: Mutex::new(child_killer),
        writer: Mutex::new(writer),
        reader: Mutex::new(reader),
    });
    state.sessions.write().await.insert(id, session);
    Ok(id)
}

async fn session_of(state: &tauri::State<'_, PtyState>, id: PtyId) -> Result<std::sync::Arc<Session>, String> {
    state.sessions.read().await.get(&id).cloned().ok_or_else(|| "unknown pty id".into())
}

#[tauri::command]
pub async fn pty_write(id: PtyId, data: String, state: tauri::State<'_, PtyState>) -> Result<(), String> {
    let session = session_of(&state, id).await?;
    let result = session.writer.lock().await.write_all(data.as_bytes()).map_err(|e| e.to_string());
    result
}

// Blocks until at least one chunk of output is available (or EOF) — the
// frontend calls this in a tight loop (see usePty.ts), the same long-poll
// shape the reference plugin uses. A blocking read on a background async
// task is fine here: it only ties up one entry in tauri's async runtime,
// not the main thread.
#[tauri::command]
pub async fn pty_read(id: PtyId, state: tauri::State<'_, PtyState>) -> Result<tauri::ipc::Response, String> {
    let session = session_of(&state, id).await?;
    let mut buf = vec![0u8; 8192];
    let n = session.reader.lock().await.read(&mut buf).map_err(|e| e.to_string())?;
    if n == 0 {
        return Err("EOF".into());
    }
    buf.truncate(n);
    Ok(tauri::ipc::Response::new(buf))
}

#[tauri::command]
pub async fn pty_resize(id: PtyId, cols: u16, rows: u16, state: tauri::State<'_, PtyState>) -> Result<(), String> {
    let session = session_of(&state, id).await?;
    let result = session
        .pair
        .lock()
        .await
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string());
    result
}

#[tauri::command]
pub async fn pty_kill(id: PtyId, state: tauri::State<'_, PtyState>) -> Result<(), String> {
    let session = session_of(&state, id).await?;
    let result = session.child_killer.lock().await.kill().map_err(|e| e.to_string());
    result
}

#[tauri::command]
pub async fn pty_exitstatus(id: PtyId, state: tauri::State<'_, PtyState>) -> Result<u32, String> {
    let session = session_of(&state, id).await?;
    let code = session.child.lock().await.wait().map_err(|e| e.to_string())?.exit_code();
    state.sessions.write().await.remove(&id);
    Ok(code)
}
