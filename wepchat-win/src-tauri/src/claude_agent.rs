//! Claude Code 接入：每个 WePChat 会话一个 `claude --print` stream-json 子进程。
//! 协议与边界见 docs/claude-code-integration.md。

use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

use crate::external_agent::{quote_cmd_arg, resolve_command_path};
use crate::settings::SettingsStore;

const CLAUDE_EVENT: &str = "claude-agent";
const CLAUDE_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
// 空闲回收：无运行轮次且 10 分钟无消息则结束进程，之后 --resume 透明恢复。
const CLAUDE_IDLE_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const CLAUDE_IDLE_POLL: Duration = Duration::from_secs(30);

type Pending = Arc<Mutex<HashMap<String, mpsc::Sender<Result<Value, String>>>>>;
type SessionMap = Arc<Mutex<HashMap<String, Arc<ClaudeSession>>>>;

#[derive(Clone, Default)]
pub struct ClaudeAgent {
    sessions: SessionMap,
}

pub struct ClaudeSession {
    child: Mutex<Child>,
    stdin: Mutex<Option<ChildStdin>>,
    pending: Pending,
    next_id: AtomicU64,
    alive: Arc<AtomicBool>,
    busy: Arc<AtomicBool>,
    last_activity: Arc<Mutex<Instant>>,
    init_message: Arc<Mutex<Option<Value>>>,
    initialize_response: Mutex<Option<Value>>,
}

struct ClaudeLaunchConfig {
    command: String,
    extra_args: Vec<String>,
    env: HashMap<String, String>,
}

fn emit_claude(app: &AppHandle, session_key: &str, mut payload: Map<String, Value>) {
    payload.insert("sessionKey".into(), json!(session_key));
    let _ = app.emit(CLAUDE_EVENT, Value::Object(payload));
}

fn emit_status(app: &AppHandle, session_key: &str, status: &str) {
    let mut payload = Map::new();
    payload.insert("kind".into(), json!("status"));
    payload.insert("status".into(), json!(status));
    emit_claude(app, session_key, payload);
}

fn emit_diagnostic(app: &AppHandle, session_key: &str, level: &str, text: String) {
    let mut payload = Map::new();
    payload.insert("kind".into(), json!("diagnostic"));
    payload.insert("level".into(), json!(level));
    payload.insert("text".into(), json!(text));
    emit_claude(app, session_key, payload);
}

fn fail_pending(pending: &Pending, message: &str) {
    if let Ok(mut pending) = pending.lock() {
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err(message.to_string()));
        }
    }
}

fn claude_launch_config(app: &AppHandle) -> Result<ClaudeLaunchConfig, String> {
    let settings = SettingsStore::load(app).unwrap_or_default();
    let config = settings
        .external_connections
        .agents
        .get("claude")
        .cloned()
        .unwrap_or(Value::Null);
    let configured = config
        .get("commandPath")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("claude");
    let command = resolve_command_path(configured)?
        .ok_or_else(|| format!("未找到 Claude Code CLI：{configured}"))?;
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
    Ok(ClaudeLaunchConfig {
        command,
        extra_args,
        env,
    })
}

/// npm shim 目录下探测 2.x 自带的原生 exe，避免 cmd 包装层。
fn claude_native_binary(shim: &str) -> Option<PathBuf> {
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
    let parent = shim_path.parent()?;
    let package_root = parent
        .join("node_modules")
        .join("@anthropic-ai")
        .join("claude-code");
    let platform = if cfg!(target_arch = "aarch64") {
        "claude-code-win32-arm64"
    } else {
        "claude-code-win32-x64"
    };
    [
        package_root.join("bin").join("claude.exe"),
        package_root
            .join("node_modules")
            .join("@anthropic-ai")
            .join(platform)
            .join("claude.exe"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
}

fn claude_session_args(
    resume_id: &Option<String>,
    model: &Option<String>,
    effort: &Option<String>,
    permission_mode: &str,
) -> Vec<String> {
    let mut args: Vec<String> = [
        "--print",
        "--verbose",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--permission-mode",
        permission_mode,
    ]
    .into_iter()
    .map(str::to_string)
    .collect();
    if permission_mode == "bypassPermissions" {
        args.push("--dangerously-skip-permissions".into());
    }
    if let Some(model) = model.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        args.extend(["--model".into(), model.into()]);
    }
    if let Some(effort) = effort.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        args.extend(["--effort".into(), effort.into()]);
    }
    if let Some(resume) = resume_id.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        args.extend(["--resume".into(), resume.into()]);
    }
    args
}

fn claude_command(config: &ClaudeLaunchConfig, session_args: Vec<String>) -> Command {
    let mut args = session_args;
    args.extend(config.extra_args.iter().cloned());
    let runtime_command =
        claude_native_binary(&config.command).unwrap_or_else(|| PathBuf::from(&config.command));
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
    command
}

impl ClaudeSession {
    fn touch(&self) {
        if let Ok(mut at) = self.last_activity.lock() {
            *at = Instant::now();
        }
    }

    fn send_line(&self, message: &Value) -> Result<(), String> {
        if !self.alive.load(Ordering::Acquire) {
            return Err("Claude Code 会话进程未运行".into());
        }
        let mut stdin = self.stdin.lock().map_err(|error| error.to_string())?;
        let stdin = stdin
            .as_mut()
            .ok_or_else(|| "Claude Code stdin 已关闭".to_string())?;
        serde_json::to_writer(&mut *stdin, message).map_err(|error| error.to_string())?;
        stdin.write_all(b"\n").map_err(|error| error.to_string())?;
        stdin.flush().map_err(|error| error.to_string())?;
        self.touch();
        Ok(())
    }

    fn control(&self, subtype: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let mut request = match params {
            Value::Object(map) => map,
            Value::Null => Map::new(),
            _ => return Err("Claude Code control 参数必须是对象".into()),
        };
        request.insert("subtype".into(), json!(subtype));
        let request_id = format!("wc-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let (sender, receiver) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|error| error.to_string())?
            .insert(request_id.clone(), sender);
        let envelope = json!({
            "type": "control_request",
            "request_id": request_id,
            "request": Value::Object(request),
        });
        if let Err(error) = self.send_line(&envelope) {
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
                Err(format!("Claude Code {subtype} 超时或连接中断：{error}"))
            }
        }
    }

    fn respond(&self, request_id: &str, result: Value) -> Result<(), String> {
        self.send_line(&json!({
            "type": "control_response",
            "response": {
                "subtype": "success",
                "request_id": request_id,
                "response": result,
            },
        }))
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
        fail_pending(&self.pending, "Claude Code 会话进程已停止");
    }
}

impl ClaudeAgent {
    fn existing(&self, session_key: &str) -> Result<Arc<ClaudeSession>, String> {
        self.sessions
            .lock()
            .map_err(|error| error.to_string())?
            .get(session_key)
            .filter(|session| session.alive.load(Ordering::Acquire))
            .cloned()
            .ok_or_else(|| "Claude Code 会话未连接".to_string())
    }

    pub fn shutdown_all(&self) {
        if let Ok(mut sessions) = self.sessions.lock() {
            for (_, session) in sessions.drain() {
                session.shutdown();
            }
        }
    }
}

fn spawn_idle_reaper(sessions: SessionMap, session_key: String, session: Arc<ClaudeSession>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(CLAUDE_IDLE_POLL);
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
        if idle < CLAUDE_IDLE_TIMEOUT {
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

#[allow(clippy::too_many_arguments)]
fn start_claude_session(
    app: &AppHandle,
    manager: &ClaudeAgent,
    session_key: String,
    cwd: String,
    resume_id: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    permission_mode: String,
) -> Result<Value, String> {
    if let Some(existing) = manager
        .sessions
        .lock()
        .map_err(|error| error.to_string())?
        .get(&session_key)
        .cloned()
    {
        if existing.alive.load(Ordering::Acquire) {
            let initialize = existing
                .initialize_response
                .lock()
                .map_err(|error| error.to_string())?
                .clone();
            if let Some(initialize) = initialize {
                let init = existing
                    .init_message
                    .lock()
                    .map_err(|error| error.to_string())?
                    .clone();
                return Ok(json!({
                    "alreadyRunning": true,
                    "init": init.unwrap_or(Value::Null),
                    "initialize": initialize,
                }));
            }
            return Err("Claude Code 会话进程正在启动中".into());
        }
        existing.shutdown();
        if let Ok(mut sessions) = manager.sessions.lock() {
            sessions.remove(&session_key);
        }
    }

    if !Path::new(&cwd).is_dir() {
        return Err(format!("项目目录不存在：{cwd}"));
    }
    let mode = if permission_mode.trim().is_empty() {
        "default".to_string()
    } else {
        permission_mode
    };
    let config = claude_launch_config(app)?;
    let mut command = claude_command(
        &config,
        claude_session_args(&resume_id, &model, &effort, &mode),
    );
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
        .map_err(|error| format!("无法启动 Claude Code：{error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "无法打开 Claude Code stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法打开 Claude Code stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法打开 Claude Code stderr".to_string())?;

    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
    let alive = Arc::new(AtomicBool::new(true));
    let busy = Arc::new(AtomicBool::new(false));
    let last_activity = Arc::new(Mutex::new(Instant::now()));
    let init_message = Arc::new(Mutex::new(None::<Value>));
    let stderr_tail = Arc::new(Mutex::new(Vec::<String>::new()));

    let session = Arc::new(ClaudeSession {
        child: Mutex::new(child),
        stdin: Mutex::new(Some(stdin)),
        pending: pending.clone(),
        next_id: AtomicU64::new(1),
        alive: alive.clone(),
        busy: busy.clone(),
        last_activity: last_activity.clone(),
        init_message: init_message.clone(),
        initialize_response: Mutex::new(None),
    });

    // stderr：保留末尾 20 行用于启动失败提示，同 codex。
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

    let stdout_app = app.clone();
    let stdout_key = session_key.clone();
    let stdout_pending = pending.clone();
    let stdout_alive = alive.clone();
    let stdout_busy = busy.clone();
    let stdout_activity = last_activity.clone();
    let stdout_init = init_message.clone();
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
                        format!("无效的 stream-json 行：{error}"),
                    );
                    continue;
                }
            };
            if let Ok(mut at) = stdout_activity.lock() {
                *at = Instant::now();
            }
            let message_type = message.get("type").and_then(Value::as_str).unwrap_or("");
            match message_type {
                // 我方 control_request 的应答：回填等待者。
                "control_response" => {
                    let response = message.get("response").cloned().unwrap_or(Value::Null);
                    let request_id = response
                        .get("request_id")
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    let sender = request_id.and_then(|id| {
                        stdout_pending.lock().ok().and_then(|mut p| p.remove(&id))
                    });
                    if let Some(sender) = sender {
                        let result =
                            if response.get("subtype").and_then(Value::as_str) == Some("error") {
                                Err(response
                                    .get("error")
                                    .and_then(Value::as_str)
                                    .unwrap_or("Claude Code control 请求失败")
                                    .to_string())
                            } else {
                                Ok(response.get("response").cloned().unwrap_or(Value::Null))
                            };
                        let _ = sender.send(result);
                    }
                }
                // 服务端控制请求（can_use_tool 审批等）。
                "control_request" => {
                    let mut payload = Map::new();
                    payload.insert("kind".into(), json!("controlRequest"));
                    payload.insert("message".into(), message);
                    emit_claude(&stdout_app, &stdout_key, payload);
                }
                // 其余消息流原样透出；未知类型由前端忽略。
                _ => {
                    // system/init 在首条用户消息之后才出现（实测），此处仅捕获备用。
                    if message_type == "system"
                        && message.get("subtype").and_then(Value::as_str) == Some("init")
                    {
                        if let Ok(mut slot) = stdout_init.lock() {
                            *slot = Some(message.clone());
                        }
                    }
                    if message_type == "result" {
                        stdout_busy.store(false, Ordering::Release);
                    }
                    let mut payload = Map::new();
                    payload.insert("kind".into(), json!("message"));
                    payload.insert("message".into(), message);
                    emit_claude(&stdout_app, &stdout_key, payload);
                }
            }
        }
        stdout_alive.store(false, Ordering::Release);
        stdout_busy.store(false, Ordering::Release);
        fail_pending(&stdout_pending, "Claude Code 会话进程已断开");
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

    // initialize 握手：启动后直接发（实测 CLI 启动即应答）；
    // system/init 要等首条用户消息之后才出现，不能在这里等它。
    let initialize = match session.control("initialize", json!({}), CLAUDE_REQUEST_TIMEOUT) {
        Ok(response) => response,
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
            return Err(cleanup(format!(
                "Claude Code initialize 失败：{error}{detail}"
            )));
        }
    };
    if let Ok(mut slot) = session.initialize_response.lock() {
        *slot = Some(initialize.clone());
    }

    spawn_idle_reaper(manager.sessions.clone(), session_key.clone(), session);
    emit_status(app, &session_key, "connected");
    Ok(json!({ "initialize": initialize }))
}

fn allowed_claude_control(subtype: &str) -> bool {
    matches!(
        subtype,
        "interrupt"
            | "set_permission_mode"
            | "set_model"
            | "set_max_thinking_tokens"
            | "rename_session"
            | "get_context_usage"
            | "get_session_cost"
            | "list_models"
            | "get_workspace_diff"
            | "initialize"
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn claude_start(
    app: AppHandle,
    state: tauri::State<'_, ClaudeAgent>,
    session_key: String,
    cwd: String,
    resume_id: Option<String>,
    model: Option<String>,
    effort: Option<String>,
    permission_mode: Option<String>,
) -> Result<Value, String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        start_claude_session(
            &app,
            &manager,
            session_key,
            cwd,
            resume_id,
            model,
            effort,
            permission_mode.unwrap_or_else(|| "default".into()),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn claude_send(
    state: tauri::State<'_, ClaudeAgent>,
    session_key: String,
    message: Value,
) -> Result<(), String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let session = manager.existing(&session_key)?;
        session.send_line(&message)?;
        session.busy.store(true, Ordering::Release);
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn claude_control(
    state: tauri::State<'_, ClaudeAgent>,
    session_key: String,
    subtype: String,
    params: Value,
) -> Result<Value, String> {
    if !allowed_claude_control(&subtype) {
        return Err(format!("不支持的 Claude Code control 请求：{subtype}"));
    }
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager
            .existing(&session_key)?
            .control(&subtype, params, CLAUDE_REQUEST_TIMEOUT)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn claude_respond(
    state: tauri::State<'_, ClaudeAgent>,
    session_key: String,
    request_id: String,
    result: Value,
) -> Result<(), String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager.existing(&session_key)?.respond(&request_id, result)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn claude_stop(
    state: tauri::State<'_, ClaudeAgent>,
    session_key: String,
) -> Result<(), String> {
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
pub async fn claude_stop_all(state: tauri::State<'_, ClaudeAgent>) -> Result<(), String> {
    let manager = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager.shutdown_all())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn claude_status(state: tauri::State<'_, ClaudeAgent>) -> Value {
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
