use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use crate::settings::SettingsStore;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportedAgent {
    pub kind: String,
    pub name: String,
    pub command: String,
    pub protocol: String,
    pub default_args: Vec<String>,
    pub icon: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDetection {
    pub kind: String,
    pub name: String,
    pub command: String,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
}

const CODEX_EVENT: &str = "codex-app-server";
const CODEX_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Default)]
pub struct CodexAppServer {
    connection: Arc<Mutex<Option<Arc<CodexConnection>>>>,
}

struct CodexConnection {
    child: Mutex<Child>,
    stdin: Mutex<Option<ChildStdin>>,
    pending: Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>,
    next_id: AtomicU64,
    alive: Arc<AtomicBool>,
}

struct AgentLaunchConfig {
    command: String,
    extra_args: Vec<String>,
    env: HashMap<String, String>,
}

#[cfg(windows)]
pub(crate) fn configure_background_command(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(crate) fn configure_background_command(_command: &mut Command) {}

fn supported_agents() -> Vec<SupportedAgent> {
    vec![
        SupportedAgent {
            kind: "codex".into(),
            name: "Codex".into(),
            command: "codex".into(),
            protocol: "json-rpc".into(),
            default_args: Vec::new(),
            icon: "codex".into(),
        },
        SupportedAgent {
            kind: "claude".into(),
            name: "Claude Code".into(),
            command: "claude".into(),
            protocol: "cli".into(),
            default_args: Vec::new(),
            icon: "claude".into(),
        },
        SupportedAgent {
            kind: "pi".into(),
            name: "Pi".into(),
            command: "pi".into(),
            protocol: "json-rpc".into(),
            default_args: Vec::new(),
            icon: "pi".into(),
        },
    ]
}

#[tauri::command]
pub fn external_agent_supported() -> Result<Vec<SupportedAgent>, String> {
    Ok(supported_agents())
}

fn windows_existing_command_candidate(raw: &str) -> Option<PathBuf> {
    let path = PathBuf::from(raw.trim());
    if !cfg!(windows) {
        return path.exists().then_some(path);
    }
    if path.extension().is_none() {
        for ext in ["cmd", "exe", "bat", "com", "ps1"] {
            let mut candidate = path.clone();
            candidate.set_extension(ext);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    path.exists().then_some(path)
}

fn has_path_separator(value: &str) -> bool {
    value.contains('\\') || value.contains('/')
}

fn where_command(command: &str) -> Result<Option<String>, String> {
    let mut locator = if cfg!(windows) {
        Command::new("where")
    } else {
        Command::new("which")
    };
    locator
        .arg(command)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_background_command(&mut locator);
    let output = locator.output().map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(None);
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let lines = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    if cfg!(windows) {
        for line in &lines {
            if let Some(candidate) = windows_existing_command_candidate(line) {
                return Ok(Some(candidate.to_string_lossy().into_owned()));
            }
        }
    }
    Ok(lines.first().map(|line| (*line).to_string()))
}

pub(crate) fn resolve_command_path(path_or_command: &str) -> Result<Option<String>, String> {
    let value = path_or_command.trim();
    if value.is_empty() {
        return Ok(None);
    }
    let path = Path::new(value);
    if path.is_absolute() || has_path_separator(value) {
        return Ok(windows_existing_command_candidate(value)
            .map(|path| path.to_string_lossy().into_owned()));
    }
    where_command(value)
}

pub(crate) fn version_of(path_or_command: &str) -> Option<String> {
    let mut command = Command::new(path_or_command);
    command
        .arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_background_command(&mut command);
    command.output().ok().and_then(|out| {
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let text = if !stdout.is_empty() { stdout } else { stderr };
        if text.is_empty() {
            None
        } else {
            Some(text.lines().next().unwrap_or("").trim().to_string())
        }
    })
}

fn codex_launch_config(app: &AppHandle) -> Result<AgentLaunchConfig, String> {
    let settings = SettingsStore::load(app).unwrap_or_default();
    let config = settings
        .external_connections
        .agents
        .get("codex")
        .cloned()
        .unwrap_or(Value::Null);
    let configured = config
        .get("commandPath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("codex");
    let command = resolve_command_path(configured)?
        .ok_or_else(|| format!("Codex CLI not found: {configured}"))?;
    let extra_args = config
        .get("extraArgs")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                // Legacy ACP builds used this flag. It is not accepted by codex app-server.
                .filter(|value| value.trim() != "--acp")
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let env = config
        .get("env")
        .and_then(Value::as_object)
        .map(|values| {
            values
                .iter()
                .filter_map(|(key, value)| value.as_str().map(|value| (key.clone(), value.into())))
                .collect()
        })
        .unwrap_or_default();

    Ok(AgentLaunchConfig {
        command,
        extra_args,
        env,
    })
}

pub(crate) fn quote_cmd_arg(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn codex_native_binary(shim: &str) -> Option<PathBuf> {
    if !cfg!(windows) {
        return None;
    }
    let parent = Path::new(shim).parent()?;
    let (package, target) = if cfg!(target_arch = "aarch64") {
        ("codex-win32-arm64", "aarch64-pc-windows-msvc")
    } else {
        ("codex-win32-x64", "x86_64-pc-windows-msvc")
    };
    let package_root = parent.join("node_modules").join("@openai").join("codex");
    [
        package_root
            .join("node_modules")
            .join("@openai")
            .join(package)
            .join("vendor")
            .join(target)
            .join("bin")
            .join("codex.exe"),
        package_root
            .join("vendor")
            .join(target)
            .join("bin")
            .join("codex.exe"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
}

fn codex_command(config: &AgentLaunchConfig) -> Command {
    let mut args = config.extra_args.clone();
    args.extend(["app-server".into(), "--stdio".into()]);
    let runtime_command =
        codex_native_binary(&config.command).unwrap_or_else(|| PathBuf::from(&config.command));
    let extension = runtime_command
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let mut command = if cfg!(windows) && matches!(extension.as_str(), "cmd" | "bat") {
        let command_line = std::iter::once(runtime_command.to_string_lossy().into_owned())
            .chain(args.iter().cloned())
            .map(|value| quote_cmd_arg(&value))
            .collect::<Vec<_>>()
            .join(" ");
        let mut command = Command::new("cmd.exe");
        command.args(["/D", "/S", "/C", &format!("call {command_line}")]);
        command
    } else {
        let mut command = Command::new(runtime_command);
        command.args(args);
        command
    };
    command.envs(&config.env);
    configure_background_command(&mut command);
    command
}

fn emit_codex(app: &AppHandle, payload: Value) {
    let _ = app.emit(CODEX_EVENT, payload);
}

impl CodexConnection {
    fn send(&self, message: &Value) -> Result<(), String> {
        if !self.alive.load(Ordering::Acquire) {
            return Err("Codex app-server is not running".into());
        }
        let mut stdin = self.stdin.lock().map_err(|error| error.to_string())?;
        let stdin = stdin
            .as_mut()
            .ok_or_else(|| "Codex app-server stdin is closed".to_string())?;
        serde_json::to_writer(&mut *stdin, message).map_err(|error| error.to_string())?;
        stdin.write_all(b"\n").map_err(|error| error.to_string())?;
        stdin.flush().map_err(|error| error.to_string())
    }

    fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|error| error.to_string())?
            .insert(id, sender);
        if let Err(error) = self.send(&json!({ "id": id, "method": method, "params": params })) {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&id);
            }
            return Err(error);
        }
        match receiver.recv_timeout(timeout) {
            Ok(result) => result,
            Err(error) => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&id);
                }
                Err(format!("Codex {method} timed out or disconnected: {error}"))
            }
        }
    }

    fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.send(&json!({ "method": method, "params": params }))
    }

    fn respond(&self, request_id: Value, result: Value) -> Result<(), String> {
        self.send(&json!({ "id": request_id, "result": result }))
    }

    fn shutdown(&self) {
        self.alive.store(false, Ordering::Release);
        if let Ok(mut stdin) = self.stdin.lock() {
            stdin.take();
        }
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        fail_pending(&self.pending, "Codex app-server stopped");
    }
}

fn fail_pending(
    pending: &Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>,
    message: &str,
) {
    if let Ok(mut pending) = pending.lock() {
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err(message.to_string()));
        }
    }
}

fn handle_codex_message(
    app: &AppHandle,
    pending: &Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>,
    message: Value,
) {
    let response_id = message.get("id").and_then(Value::as_u64);
    let is_server_request = message.get("method").is_some() && message.get("id").is_some();
    if let Some(id) = response_id.filter(|_| !is_server_request) {
        let sender = pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(&id));
        if let Some(sender) = sender {
            let result = if let Some(error) = message.get("error") {
                Err(error
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Codex app-server request failed")
                    .to_string())
            } else {
                Ok(message.get("result").cloned().unwrap_or(Value::Null))
            };
            let _ = sender.send(result);
        }
        return;
    }

    let kind = if is_server_request {
        "serverRequest"
    } else {
        "notification"
    };
    emit_codex(app, json!({ "kind": kind, "message": message }));
}

fn start_codex_connection(app: &AppHandle) -> Result<Arc<CodexConnection>, String> {
    let config = codex_launch_config(app)?;
    let mut command = codex_command(&config);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start Codex app-server: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open Codex app-server stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open Codex app-server stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to open Codex app-server stderr".to_string())?;
    let pending = Arc::new(Mutex::new(HashMap::new()));
    let alive = Arc::new(AtomicBool::new(true));
    let connection = Arc::new(CodexConnection {
        child: Mutex::new(child),
        stdin: Mutex::new(Some(stdin)),
        pending: pending.clone(),
        next_id: AtomicU64::new(1),
        alive: alive.clone(),
    });

    let stdout_app = app.clone();
    let stdout_pending = pending.clone();
    let stdout_alive = alive.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) if line.trim().is_empty() => continue,
                Ok(line) => match serde_json::from_str::<Value>(&line) {
                    Ok(message) => handle_codex_message(&stdout_app, &stdout_pending, message),
                    Err(error) => emit_codex(
                        &stdout_app,
                        json!({ "kind": "diagnostic", "level": "error", "text": format!("Invalid app-server JSONL: {error}") }),
                    ),
                },
                Err(error) => {
                    emit_codex(
                        &stdout_app,
                        json!({ "kind": "diagnostic", "level": "error", "text": error.to_string() }),
                    );
                    break;
                }
            }
        }
        stdout_alive.store(false, Ordering::Release);
        fail_pending(&stdout_pending, "Codex app-server disconnected");
        emit_codex(
            &stdout_app,
            json!({ "kind": "status", "status": "disconnected" }),
        );
    });

    let stderr_app = app.clone();
    let stderr_lines = Arc::new(Mutex::new(Vec::<String>::new()));
    let stderr_capture = stderr_lines.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if !line.trim().is_empty() {
                if let Ok(mut lines) = stderr_capture.lock() {
                    lines.push(line.clone());
                    if lines.len() > 20 {
                        lines.remove(0);
                    }
                }
                emit_codex(
                    &stderr_app,
                    json!({ "kind": "diagnostic", "level": "info", "text": line }),
                );
            }
        }
    });

    let initialized = connection.request(
        "initialize",
        json!({
            "clientInfo": {
                "name": "wepchat",
                "title": "WePChat",
                "version": env!("CARGO_PKG_VERSION")
            }
        }),
        CODEX_REQUEST_TIMEOUT,
    );
    if let Err(error) = initialized {
        connection.shutdown();
        std::thread::sleep(Duration::from_millis(30));
        let diagnostics = stderr_lines
            .lock()
            .map(|lines| lines.join("\n"))
            .unwrap_or_default();
        let detail = if diagnostics.is_empty() {
            String::new()
        } else {
            format!("\n{diagnostics}")
        };
        return Err(format!(
            "Failed to initialize Codex app-server: {error}{detail}"
        ));
    }
    if let Err(error) = connection.notify("initialized", json!({})) {
        connection.shutdown();
        return Err(format!("Failed to acknowledge Codex app-server: {error}"));
    }
    emit_codex(
        app,
        json!({ "kind": "status", "status": "connected", "command": config.command }),
    );
    Ok(connection)
}

impl CodexAppServer {
    fn get_or_start(&self, app: &AppHandle) -> Result<Arc<CodexConnection>, String> {
        let mut slot = self.connection.lock().map_err(|error| error.to_string())?;
        if let Some(connection) = slot.as_ref() {
            if connection.alive.load(Ordering::Acquire) {
                return Ok(connection.clone());
            }
            connection.shutdown();
        }
        let connection = start_codex_connection(app)?;
        *slot = Some(connection.clone());
        Ok(connection)
    }

    pub fn shutdown(&self) {
        if let Ok(mut slot) = self.connection.lock() {
            if let Some(connection) = slot.take() {
                connection.shutdown();
            }
        }
    }

    fn existing(&self) -> Result<Arc<CodexConnection>, String> {
        self.connection
            .lock()
            .map_err(|error| error.to_string())?
            .as_ref()
            .filter(|connection| connection.alive.load(Ordering::Acquire))
            .cloned()
            .ok_or_else(|| "Codex app-server is not connected".to_string())
    }
}

fn allowed_codex_method(method: &str) -> bool {
    matches!(
        method,
        "model/list"
            | "account/read"
            | "thread/start"
            | "thread/resume"
            | "thread/read"
            | "thread/list"
            | "thread/name/set"
            | "thread/archive"
            | "turn/start"
            | "turn/steer"
            | "turn/interrupt"
            | "review/start"
            | "fs/readDirectory"
            | "fs/readFile"
    )
}

#[tauri::command]
pub async fn codex_request(
    app: AppHandle,
    state: tauri::State<'_, CodexAppServer>,
    method: String,
    params: Value,
) -> Result<Value, String> {
    if !allowed_codex_method(&method) {
        return Err(format!("Unsupported Codex app-server method: {method}"));
    }
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager
            .get_or_start(&app)?
            .request(&method, params, CODEX_REQUEST_TIMEOUT)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn codex_respond(
    state: tauri::State<'_, CodexAppServer>,
    request_id: Value,
    result: Value,
) -> Result<(), String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.existing()?.respond(request_id, result))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn codex_status(state: tauri::State<'_, CodexAppServer>) -> Value {
    let connected = state
        .connection
        .lock()
        .ok()
        .and_then(|slot| {
            slot.as_ref()
                .map(|connection| connection.alive.load(Ordering::Acquire))
        })
        .unwrap_or(false);
    json!({ "connected": connected })
}

#[tauri::command]
pub async fn codex_disconnect(state: tauri::State<'_, CodexAppServer>) -> Result<(), String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.shutdown())
        .await
        .map_err(|error| error.to_string())
}

fn detect_agent(app: &AppHandle, agent: SupportedAgent) -> Result<AgentDetection, String> {
    let settings = SettingsStore::load(app).unwrap_or_default();
    let manual = settings
        .external_connections
        .agents
        .get(&agent.kind)
        .and_then(|v| v.get("commandPath"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let detected = if let Some(path_or_command) = manual {
        resolve_command_path(&path_or_command)?
    } else {
        where_command(&agent.command)?
    };

    Ok(AgentDetection {
        kind: agent.kind,
        name: agent.name,
        command: agent.command,
        installed: detected.is_some(),
        version: detected.as_deref().and_then(version_of),
        path: detected,
        error: None,
    })
}

#[tauri::command]
pub async fn external_agent_detect(app: AppHandle, kind: String) -> Result<AgentDetection, String> {
    let agent = supported_agents()
        .into_iter()
        .find(|agent| agent.kind == kind)
        .ok_or_else(|| format!("unsupported external agent: {kind}"))?;

    tauri::async_runtime::spawn_blocking(move || detect_agent(&app, agent))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn external_agent_detect_all(app: AppHandle) -> Result<Vec<AgentDetection>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        supported_agents()
            .into_iter()
            .map(|agent| detect_agent(&app, agent))
            .collect()
    })
    .await
    .map_err(|error| error.to_string())?
}
