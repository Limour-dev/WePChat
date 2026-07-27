//! Pi 接入：每个 WePChat 会话一个 `pi --mode rpc` JSONL 子进程。
//! 协议与边界见 docs/pi-integration.md（权威信源：pi 包内 docs/rpc.md）。

use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::external_agent::{quote_cmd_arg, resolve_command_path, version_of};
use crate::settings::SettingsStore;

const PI_EVENT: &str = "pi-agent";
const PI_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
// 空闲回收：无运行轮次且 10 分钟无消息则结束进程，之后 --session 透明恢复。
const PI_IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const PI_IDLE_POLL: Duration = Duration::from_secs(30);

type Pending = Arc<Mutex<HashMap<String, mpsc::Sender<Result<Value, String>>>>>;
type SessionMap = Arc<Mutex<HashMap<String, Arc<PiSession>>>>;

#[derive(Clone, Default)]
pub struct PiAgent {
    sessions: SessionMap,
}

pub struct PiSession {
    child: Mutex<Child>,
    stdin: Mutex<Option<ChildStdin>>,
    pending: Pending,
    next_id: AtomicU64,
    alive: Arc<AtomicBool>,
    busy: Arc<AtomicBool>,
    last_activity: Arc<Mutex<Instant>>,
}

struct PiLaunchConfig {
    command: String,
    extra_args: Vec<String>,
    env: HashMap<String, String>,
}

fn emit_pi(app: &AppHandle, session_key: &str, mut payload: Map<String, Value>) {
    payload.insert("sessionKey".into(), json!(session_key));
    let _ = app.emit(PI_EVENT, Value::Object(payload));
}

fn emit_status(app: &AppHandle, session_key: &str, status: &str) {
    let mut payload = Map::new();
    payload.insert("kind".into(), json!("status"));
    payload.insert("status".into(), json!(status));
    emit_pi(app, session_key, payload);
}

fn emit_diagnostic(app: &AppHandle, session_key: &str, level: &str, text: String) {
    let mut payload = Map::new();
    payload.insert("kind".into(), json!("diagnostic"));
    payload.insert("level".into(), json!(level));
    payload.insert("text".into(), json!(text));
    emit_pi(app, session_key, payload);
}

fn fail_pending(pending: &Pending, message: &str) {
    if let Ok(mut pending) = pending.lock() {
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err(message.to_string()));
        }
    }
}

fn pi_launch_config(app: &AppHandle) -> Result<PiLaunchConfig, String> {
    let settings = SettingsStore::load(app).unwrap_or_default();
    let config = settings
        .external_connections
        .agents
        .get("pi")
        .cloned()
        .unwrap_or(Value::Null);
    let configured = config
        .get("commandPath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("pi");
    let command =
        resolve_command_path(configured)?.ok_or_else(|| format!("未找到 Pi CLI：{configured}"))?;
    let extra_args = config
        .get("extraArgs")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
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
    Ok(PiLaunchConfig {
        command,
        extra_args,
        env,
    })
}

/// pi 包没有原生 exe（入口是纯 Node 的 dist/cli.js）。
/// 长驻子进程优先 `node <包根>/dist/cli.js` 直启（kill 干净），兜底 cmd 包装 shim。
fn pi_node_entry(shim: &str) -> Option<(String, PathBuf)> {
    if !cfg!(windows) {
        return None;
    }
    let shim_path = Path::new(shim);
    let is_exe = shim_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("exe"))
        .unwrap_or(false);
    if is_exe {
        return None;
    }
    let cli = shim_path
        .parent()?
        .join("node_modules")
        .join("@earendil-works")
        .join("pi-coding-agent")
        .join("dist")
        .join("cli.js");
    if !cli.is_file() {
        return None;
    }
    let node = resolve_command_path("node").ok().flatten()?;
    Some((node, cli))
}

/// `--approve`（信任当前项目目录）0.79 起可用；低版本不传。
fn pi_supports_approve(command: &str) -> bool {
    let Some(version) = version_of(command) else {
        return false;
    };
    let mut parts = version
        .split(|c: char| !c.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<u64>().ok());
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    major > 0 || minor >= 79
}

fn pi_session_args(session_file: &Option<String>, name: &Option<String>, approve: bool) -> Vec<String> {
    let mut args: Vec<String> = vec!["--mode".into(), "rpc".into()];
    if approve {
        args.push("--approve".into());
    }
    if let Some(file) = session_file.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        args.extend(["--session".into(), file.into()]);
    }
    if let Some(name) = name.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        args.extend(["--name".into(), name.into()]);
    }
    args
}

fn pi_command(config: &PiLaunchConfig, session_args: Vec<String>) -> Command {
    let mut args = session_args;
    args.extend(config.extra_args.iter().cloned());

    let mut command = if let Some((node, cli)) = pi_node_entry(&config.command) {
        let mut command = Command::new(node);
        command.arg(cli);
        command.args(args);
        command
    } else {
        let runtime_command = PathBuf::from(&config.command);
        let extension = runtime_command
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if cfg!(windows) && matches!(extension.as_str(), "cmd" | "bat") {
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
        }
    };
    command.envs(&config.env);
    command
}

impl PiSession {
    fn touch(&self) {
        if let Ok(mut at) = self.last_activity.lock() {
            *at = Instant::now();
        }
    }

    fn send_line(&self, message: &Value) -> Result<(), String> {
        if !self.alive.load(Ordering::Acquire) {
            return Err("Pi 会话进程未运行".into());
        }
        let mut stdin = self.stdin.lock().map_err(|error| error.to_string())?;
        let stdin = stdin
            .as_mut()
            .ok_or_else(|| "Pi stdin 已关闭".to_string())?;
        serde_json::to_writer(&mut *stdin, message).map_err(|error| error.to_string())?;
        stdin.write_all(b"\n").map_err(|error| error.to_string())?;
        stdin.flush().map_err(|error| error.to_string())?;
        self.touch();
        Ok(())
    }

    /// 发送带 id 的命令并等待同 id 的 response；成功回 data，失败回 error 文本。
    fn request(&self, command: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let mut message = match params {
            Value::Object(map) => map,
            Value::Null => Map::new(),
            _ => return Err("Pi 命令参数必须是对象".into()),
        };
        let request_id = format!("wc-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        message.insert("id".into(), json!(request_id));
        message.insert("type".into(), json!(command));
        let (sender, receiver) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|error| error.to_string())?
            .insert(request_id.clone(), sender);
        if let Err(error) = self.send_line(&Value::Object(message)) {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&request_id);
            }
            return Err(error);
        }
        match receiver.recv_timeout(timeout) {
            Ok(result) => result,
            Err(error) => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&request_id);
                }
                Err(format!("Pi {command} 超时或连接中断：{error}"))
            }
        }
    }

    fn shutdown(&self) {
        self.alive.store(false, Ordering::Release);
        self.busy.store(false, Ordering::Release);
        if let Ok(mut stdin) = self.stdin.lock() {
            stdin.take();
        }
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        fail_pending(&self.pending, "Pi 会话进程已停止");
    }
}

impl PiAgent {
    fn existing(&self, session_key: &str) -> Result<Arc<PiSession>, String> {
        self.sessions
            .lock()
            .map_err(|error| error.to_string())?
            .get(session_key)
            .filter(|session| session.alive.load(Ordering::Acquire))
            .cloned()
            .ok_or_else(|| "Pi 会话未连接".to_string())
    }

    pub fn shutdown_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, session) in sessions.drain() {
                session.shutdown();
            }
        }
    }
}

fn spawn_idle_reaper(sessions: SessionMap, session_key: String, session: Arc<PiSession>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(PI_IDLE_POLL);
        if !session.alive.load(Ordering::Acquire) {
            break;
        }
        if session.busy.load(Ordering::Acquire) {
            continue;
        }
        let idle = session
            .last_activity
            .lock()
            .map(|at| at.elapsed())
            .unwrap_or_default();
        if idle < PI_IDLE_TIMEOUT {
            continue;
        }
        if let Ok(mut map) = sessions.lock() {
            if map
                .get(&session_key)
                .map(|entry| Arc::ptr_eq(entry, &session))
                .unwrap_or(false)
            {
                map.remove(&session_key);
            }
        }
        // stdout 线程在 EOF 时统一发 disconnected 状态。
        session.shutdown();
        break;
    });
}

fn start_pi_session(
    app: &AppHandle,
    manager: &PiAgent,
    session_key: String,
    cwd: String,
    session_file: Option<String>,
    name: Option<String>,
) -> Result<Value, String> {
    if let Some(existing) = manager
        .sessions
        .lock()
        .map_err(|error| error.to_string())?
        .get(&session_key)
        .cloned()
    {
        if existing.alive.load(Ordering::Acquire) {
            let state = existing.request("get_state", Value::Null, PI_REQUEST_TIMEOUT)?;
            return Ok(json!({ "alreadyRunning": true, "state": state }));
        }
        existing.shutdown();
        if let Ok(mut sessions) = manager.sessions.lock() {
            sessions.remove(&session_key);
        }
    }

    if !Path::new(&cwd).is_dir() {
        return Err(format!("项目目录不存在：{cwd}"));
    }
    let config = pi_launch_config(app)?;
    let approve = pi_supports_approve(&config.command);
    let mut command = pi_command(&config, pi_session_args(&session_file, &name, approve));
    command
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 Pi：{error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "无法打开 Pi stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法打开 Pi stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法打开 Pi stderr".to_string())?;

    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
    let alive = Arc::new(AtomicBool::new(true));
    let busy = Arc::new(AtomicBool::new(false));
    let last_activity = Arc::new(Mutex::new(Instant::now()));
    let stderr_tail = Arc::new(Mutex::new(Vec::<String>::new()));

    let session = Arc::new(PiSession {
        child: Mutex::new(child),
        stdin: Mutex::new(Some(stdin)),
        pending: pending.clone(),
        next_id: AtomicU64::new(1),
        alive: alive.clone(),
        busy: busy.clone(),
        last_activity: last_activity.clone(),
    });

    // stderr：保留末尾 20 行用于启动失败提示，同 codex / claude。
    let stderr_app = app.clone();
    let stderr_key = session_key.clone();
    let stderr_capture = stderr_tail.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(mut lines) = stderr_capture.lock() {
                lines.push(line.clone());
                if lines.len() > 20 {
                    lines.remove(0);
                }
            }
            emit_diagnostic(&stderr_app, &stderr_key, "info", line);
        }
    });

    // stdout：BufRead::lines 按 \n 切分并去尾部 \r，符合 rpc.md 的严格 JSONL 框架要求。
    let stdout_app = app.clone();
    let stdout_key = session_key.clone();
    let stdout_pending = pending.clone();
    let stdout_alive = alive.clone();
    let stdout_busy = busy.clone();
    let stdout_activity = last_activity.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let line = match line {
                Ok(line) => line,
                Err(error) => {
                    emit_diagnostic(&stdout_app, &stdout_key, "error", error.to_string());
                    break;
                }
            };
            if line.trim().is_empty() {
                continue;
            }
            let message = match serde_json::from_str::<Value>(&line) {
                Ok(message) => message,
                Err(error) => {
                    emit_diagnostic(
                        &stdout_app,
                        &stdout_key,
                        "error",
                        format!("无效的 RPC JSONL 行：{error}"),
                    );
                    continue;
                }
            };
            if let Ok(mut at) = stdout_activity.lock() {
                *at = Instant::now();
            }
            let message_type = message.get("type").and_then(Value::as_str).unwrap_or("");
            match message_type {
                // 我方命令的应答：回填等待者；无 id 命中的（如 parse 错误响应）作为事件透出。
                "response" => {
                    let sender = message
                        .get("id")
                        .and_then(Value::as_str)
                        .and_then(|id| stdout_pending.lock().ok().and_then(|mut p| p.remove(id)));
                    if let Some(sender) = sender {
                        let result = if message.get("success").and_then(Value::as_bool) == Some(true)
                        {
                            Ok(message.get("data").cloned().unwrap_or(Value::Null))
                        } else {
                            Err(message
                                .get("error")
                                .and_then(Value::as_str)
                                .unwrap_or("Pi 命令执行失败")
                                .to_string())
                        };
                        let _ = sender.send(result);
                    } else {
                        let mut payload = Map::new();
                        payload.insert("kind".into(), json!("event"));
                        payload.insert("message".into(), message);
                        emit_pi(&stdout_app, &stdout_key, payload);
                    }
                }
                // 扩展 UI 子协议（对话类需 pi_ui_respond 应答）。
                "extension_ui_request" => {
                    let mut payload = Map::new();
                    payload.insert("kind".into(), json!("uiRequest"));
                    payload.insert("message".into(), message);
                    emit_pi(&stdout_app, &stdout_key, payload);
                }
                // 其余事件原样透出；未知类型由前端忽略（协议开放集合）。
                _ => {
                    if message_type == "agent_start" {
                        stdout_busy.store(true, Ordering::Release);
                    }
                    if message_type == "agent_end" {
                        stdout_busy.store(false, Ordering::Release);
                    }
                    let mut payload = Map::new();
                    payload.insert("kind".into(), json!("event"));
                    payload.insert("message".into(), message);
                    emit_pi(&stdout_app, &stdout_key, payload);
                }
            }
        }
        stdout_alive.store(false, Ordering::Release);
        stdout_busy.store(false, Ordering::Release);
        fail_pending(&stdout_pending, "Pi 会话进程已断开");
        emit_status(&stdout_app, &stdout_key, "disconnected");
    });

    manager
        .sessions
        .lock()
        .map_err(|error| error.to_string())?
        .insert(session_key.clone(), session.clone());

    let cleanup = |message: String| {
        session.shutdown();
        if let Ok(mut sessions) = manager.sessions.lock() {
            if sessions
                .get(&session_key)
                .map(|entry| Arc::ptr_eq(entry, &session))
                .unwrap_or(false)
            {
                sessions.remove(&session_key);
            }
        }
        message
    };

    // 握手：get_state 拿 sessionFile / sessionId / model / thinkingLevel，成功即视为连接就绪。
    let state = match session.request("get_state", Value::Null, PI_REQUEST_TIMEOUT) {
        Ok(state) => state,
        Err(error) => {
            std::thread::sleep(Duration::from_millis(30));
            let diagnostics = stderr_tail
                .lock()
                .map(|lines| lines.join("\n"))
                .unwrap_or_default();
            let detail = if diagnostics.is_empty() {
                String::new()
            } else {
                format!("\n{diagnostics}")
            };
            return Err(cleanup(format!("Pi get_state 失败：{error}{detail}")));
        }
    };

    spawn_idle_reaper(manager.sessions.clone(), session_key.clone(), session);
    emit_status(app, &session_key, "connected");
    Ok(json!({ "state": state }))
}

fn allowed_pi_command(command: &str) -> bool {
    matches!(
        command,
        "prompt"
            | "steer"
            | "follow_up"
            | "abort"
            | "get_state"
            | "get_available_models"
            | "set_model"
            | "set_thinking_level"
            | "get_session_stats"
            | "set_session_name"
            | "get_messages"
            | "compact"
    )
}

#[tauri::command]
pub async fn pi_start(
    app: AppHandle,
    state: tauri::State<'_, PiAgent>,
    session_key: String,
    cwd: String,
    session_file: Option<String>,
    name: Option<String>,
) -> Result<Value, String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        start_pi_session(&app, &manager, session_key, cwd, session_file, name)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn pi_request(
    state: tauri::State<'_, PiAgent>,
    session_key: String,
    command: String,
    params: Value,
) -> Result<Value, String> {
    if !allowed_pi_command(&command) {
        return Err(format!("不支持的 Pi 命令：{command}"));
    }
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let session = manager.existing(&session_key)?;
        let is_task = matches!(command.as_str(), "prompt" | "steer" | "follow_up");
        if is_task {
            // prompt 接受后到 agent_start 之间也不能被空闲回收。
            session.busy.store(true, Ordering::Release);
        }
        let result = session.request(&command, params, PI_REQUEST_TIMEOUT);
        if is_task && result.is_err() {
            session.busy.store(false, Ordering::Release);
        }
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn pi_ui_respond(
    state: tauri::State<'_, PiAgent>,
    session_key: String,
    request_id: String,
    payload: Value,
) -> Result<(), String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut message = match payload {
            Value::Object(map) => map,
            Value::Null => Map::new(),
            _ => return Err("Pi extension_ui_response 载荷必须是对象".to_string()),
        };
        message.insert("type".into(), json!("extension_ui_response"));
        message.insert("id".into(), json!(request_id));
        manager
            .existing(&session_key)?
            .send_line(&Value::Object(message))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn pi_stop(state: tauri::State<'_, PiAgent>, session_key: String) -> Result<(), String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let session = manager
            .sessions
            .lock()
            .map_err(|error| error.to_string())?
            .remove(&session_key);
        if let Some(session) = session {
            session.shutdown();
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn pi_stop_all(state: tauri::State<'_, PiAgent>) -> Result<(), String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.shutdown_all())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn pi_status(state: tauri::State<'_, PiAgent>) -> Value {
    let sessions = state
        .sessions
        .lock()
        .map(|sessions| {
            sessions
                .iter()
                .filter(|(_, session)| session.alive.load(Ordering::Acquire))
                .map(|(key, _)| key.clone())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({ "sessions": sessions })
}
