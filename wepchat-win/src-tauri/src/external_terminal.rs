use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const POWERSHELL_EVENT: &str = "powershell-terminal";

#[derive(Clone, Default)]
pub struct PowerShellTerminal {
    sessions: Arc<Mutex<HashMap<String, Arc<PowerShellConnection>>>>,
}

struct PowerShellConnection {
    child: Mutex<Box<dyn Child + Send + Sync>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    alive: Arc<AtomicBool>,
}

fn emit_terminal(app: &AppHandle, terminal_id: &str, kind: &str, text: &str) {
    let _ = app.emit(
        POWERSHELL_EVENT,
        json!({ "terminalId": terminal_id, "kind": kind, "text": text }),
    );
}

fn pty_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(2),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn start_connection(
    app: &AppHandle,
    terminal_id: &str,
    cols: u16,
    rows: u16,
) -> Result<Arc<PowerShellConnection>, String> {
    if !Path::new(terminal_id).is_dir() {
        return Err(format!("PowerShell 工作目录不存在: {terminal_id}"));
    }

    let pty = native_pty_system();
    let pair = pty
        .openpty(pty_size(cols, rows))
        .map_err(|error| format!("无法创建 Windows 终端: {error}"))?;
    let mut command = CommandBuilder::new("powershell.exe");
    command.cwd(terminal_id);
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("无法启动 PowerShell: {error}"))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("无法读取 PowerShell 终端: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("无法写入 PowerShell 终端: {error}"))?;
    let alive = Arc::new(AtomicBool::new(true));
    let connection = Arc::new(PowerShellConnection {
        child: Mutex::new(child),
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        alive: alive.clone(),
    });

    let read_app = app.clone();
    let read_id = terminal_id.to_string();
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let text = String::from_utf8_lossy(&buffer[..read]);
                    emit_terminal(&read_app, &read_id, "output", &text);
                }
                Err(error) => {
                    emit_terminal(&read_app, &read_id, "error", &error.to_string());
                    break;
                }
            }
        }
        alive.store(false, Ordering::Release);
        emit_terminal(&read_app, &read_id, "closed", "");
    });

    Ok(connection)
}

impl PowerShellConnection {
    fn write(&self, data: &str) -> Result<(), String> {
        if !self.alive.load(Ordering::Acquire) {
            return Err("PowerShell 已关闭".to_string());
        }
        let mut writer = self.writer.lock().map_err(|error| error.to_string())?;
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|error| format!("无法写入 PowerShell: {error}"))
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.master
            .lock()
            .map_err(|error| error.to_string())?
            .resize(pty_size(cols, rows))
            .map_err(|error| format!("无法调整 PowerShell 终端大小: {error}"))
    }

    fn shutdown(&self) {
        self.alive.store(false, Ordering::Release);
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl PowerShellTerminal {
    fn get_or_start(
        &self,
        app: &AppHandle,
        terminal_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<Arc<PowerShellConnection>, String> {
        let mut sessions = self.sessions.lock().map_err(|error| error.to_string())?;
        if let Some(connection) = sessions.get(terminal_id) {
            if connection.alive.load(Ordering::Acquire) {
                connection.resize(cols, rows)?;
                return Ok(connection.clone());
            }
            connection.shutdown();
        }
        let connection = start_connection(app, terminal_id, cols, rows)?;
        sessions.insert(terminal_id.to_string(), connection.clone());
        Ok(connection)
    }

    /// 结束指定终端；不传 id 时结束全部（前端关闭「终端」标签时调用）。
    fn close(&self, terminal_id: Option<&str>) {
        if let Ok(mut sessions) = self.sessions.lock() {
            match terminal_id {
                Some(id) => {
                    if let Some(connection) = sessions.remove(id) {
                        connection.shutdown();
                    }
                }
                None => {
                    for (_, connection) in sessions.drain() {
                        connection.shutdown();
                    }
                }
            }
        }
    }

    pub fn shutdown(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, connection) in sessions.drain() {
                connection.shutdown();
            }
        }
    }
}

#[tauri::command]
pub async fn powershell_terminal_open(
    app: AppHandle,
    state: tauri::State<'_, PowerShellTerminal>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let terminal = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        terminal
            .get_or_start(&app, &terminal_id, cols, rows)
            .map(|_| ())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn powershell_terminal_write(
    app: AppHandle,
    state: tauri::State<'_, PowerShellTerminal>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    let terminal = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        terminal
            .get_or_start(&app, &terminal_id, 80, 24)?
            .write(&data)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn powershell_terminal_resize(
    app: AppHandle,
    state: tauri::State<'_, PowerShellTerminal>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let terminal = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        terminal
            .get_or_start(&app, &terminal_id, cols, rows)
            .and_then(|connection| connection.resize(cols, rows))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn powershell_terminal_close(
    state: tauri::State<'_, PowerShellTerminal>,
    terminal_id: Option<String>,
) -> Result<(), String> {
    let terminal = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        terminal.close(terminal_id.as_deref());
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}
