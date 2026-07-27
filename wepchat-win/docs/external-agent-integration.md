# External Agent 接入经验

更新时间：2026-07-26

本文记录 WePChat Windows 当前已落地的 External Agent 接入方式。它是后续维护 Codex / Claude Code / Pi 集成时的唯一工程说明，不记录已废弃的 ACP、`codex exec --json`、演示终端或 mock 方案。

## 1. 当前范围

- Codex、Claude Code 与 Pi 均为真实接入的外部 Agent（Claude Code 见 §11，Pi 见 §12）。
- Codex 连接协议是 CLI 的 `app-server --stdio` JSON-RPC JSONL；Claude Code 是 `--print` 模式的 stream-json JSONL 双向流 + control 通道；Pi 是 `--mode rpc` 的命令/响应/事件 JSONL。
- 进程按首次实际发送任务启动；切换到 External Agent 页面、查看文件树或打开终端都不得隐式启动任何 Agent。
- 每个项目下可有多个会话；文件、终端与打开位置均以当前项目目录为范围。

## 2. 分层

```text
WebView
  external-agent-mode.js
    -> Tauri invoke / event
Rust
  external_agent.rs     Codex app-server 生命周期与 JSONL RPC
  claude_agent.rs       Claude Code 会话进程池与 stream-json 流
  pi_agent.rs           Pi 会话进程池与 --mode rpc JSONL
  external_project.rs   只读项目文件树与文件内容
  external_terminal.rs  Windows ConPTY + 真 PowerShell
  external_open.rs      当前项目的受限外部打开方式
    -> Codex CLI / Claude CLI / Pi CLI / Windows process
```

`src-tauri/src/lib.rs` 必须同时注册上述命令，并在窗口关闭时调用 `CodexAppServer::shutdown()`、`ClaudeAgent::shutdown_all()`、`PiAgent::shutdown_all()` 与 `PowerShellTerminal::shutdown()`，避免遗留子进程。

## 3. Codex app-server

### 启动和握手

1. 从 External Connections 设置读取 Codex 命令路径和附加参数。
2. Windows 上优先从 npm shim 所属的 `@openai/codex` 包定位原生 `codex.exe`。不要把 `.cmd` shim 直接作为长生命周期 JSONL 子进程运行。
3. 启动 `codex app-server --stdio`，stdin/stdout 使用行分隔 JSON。
4. 请求 `initialize`，成功后发送 `initialized` notification。
5. 连接成功后再请求 `model/list`；前端不得维护硬编码的可用模型列表。

Rust 侧只白名单放行实际使用的 app-server 方法。当前包括：

```text
model/list
thread/start | thread/resume | thread/read | thread/list
thread/name/set | thread/archive
turn/start | turn/interrupt
review/start
fs/readDirectory | fs/readFile
account/read
```

服务端 notification 和带 id 的 server request 必须原样通过 `codex-app-server` Tauri event 交给 WebView；不要在 Rust 中假定工具调用或审批的具体 UI。

### thread 与 turn

- 首次发送：`thread/start`，保存返回的 `thread.id`。
- 已有 thread 但本进程尚未恢复：`thread/resume`。
- 任务：`turn/start`，保存返回的 `turn.id`；停止使用 `turn/interrupt`。
- 收到 `turn/completed` 后清除 running / active turn 状态；断开时将未完成的 turn 标记为已中断，不能让发送按钮永久停留在停止状态。
- thread 名称使用 `thread/name/set`；删除会话先 `thread/archive`，RPC 成功后才删除本地索引项。

## 4. 真实可配置能力

以下控件必须来自 app-server 已声明的参数，不允许做仅改变 UI 的假开关。

| 能力 | 数据来源 / 参数 | UI 规则 |
| --- | --- | --- |
| 模型 | `model/list.data[]`、`turn/start.model` | 连接后才显示服务端返回的模型；新模型覆盖旧的无效选择。 |
| 推理强度 | `model.supportedReasoningEfforts`、`model.defaultReasoningEffort`、`turn/start.effort` | 只显示当前模型支持的值；切换模型后回退到该模型默认值。 |
| 权限 | `approvalPolicy`、`thread/start.sandbox`、`turn/start.sandboxPolicy` | 权限预设必须同时写入审批与沙箱策略。 |
| 上下文用量 | `thread/tokenUsage/updated.tokenUsage` 和 `modelContextWindow` | 仅在收到真实事件后显示百分比，禁止使用种子值或推测值。 |
| 图片附件 | `turn/start.input` 的 `{ type: "image", url }` | 只接受图片；普通任意文件不是当前协议确认的 user input。 |

当前权限预设：

| 名称 | approvalPolicy | sandbox |
| --- | --- | --- |
| 请求批准 | `on-request` | `workspace-write`，仅当前项目可写，网络关闭 |
| 替我批准 | `on-failure` | `workspace-write`，仅当前项目可写，网络关闭 |
| 完全访问权限 | `never` | `danger-full-access` |

完全访问权限只能由用户明确在输入框菜单中选择，默认值始终为“请求批准”。

## 5. 审批和工具事件

- Codex 发来的 server request 以 `request_id` 保存到对应消息的 approval 状态。
- 用户操作用 `codex_respond` 回写 `{ decision }`；每个 request 只能响应一次。
- 工具状态、agent message delta、turn started/completed、diff、token usage 都增量更新现有消息对象，避免为了流式文本重建整个页面。
- 外链一律使用 `_blank` 与 `noopener noreferrer`，由 Tauri opener 在外部打开，禁止 WebView 内部跳转覆盖当前聊天。

## 5.1 任务中追加消息 / 断开与刷新连接（2026-07-26 三家统一补齐）

- **运行中发送**：composer 是独立的发送/停止双按钮（`#external-send`/`#external-stop`，
  同款先例见生图模式 `#btn-image-send`/`#btn-image-stop`），发送键不再兼职停止键。
  `session.running` 时点发送走"追加消息"通道而不是新任务：codex 用 `turn/steer`
  （`threadId`+`expectedTurnId`+`input`，`expectedTurnId` 必须等于当前活跃 turn）；
  claude 在正常 `user` 消息上加 `"priority":"next"`（`claude_send` 透传，Rust 不用改）；
  pi 用已白名单的 `steer` 命令。新 user 气泡通过 `insertRunningUserMessage` 插到当前
  流式 assistant 气泡之前，避免"助手气泡还在变长，下面却冒出更晚消息"的错序。
- **断开/刷新连接**：顶栏连接状态文字改为可点击 button，展开抽屉提供"刷新连接"
  （断开旧进程后用同一个 resume/session id 立即重连：claude/pi 复用
  `ensureClaudeSession`/`ensurePiSession`，codex 复用 `ensureCodexConnection`）与
  "终止连接"；左侧会话列表行右键菜单同样提供"终止连接"（复用 `.context-menu` 视觉）。
  **Codex 是共享连接**（一个 `CodexAppServer` 进程管全部会话），终止/刷新会影响本次应用内
  全部 Codex 会话，确认弹窗需要明确写出这一点；claude/pi 是一会话一进程，只影响当前这个。

## 6. 项目文件

文件侧栏不依赖 Codex `fs/*`，这样在第一次任务前也可用。

- `external_project_list` / `external_project_read` 以 `root + relativePath` 接口提供只读访问。
- 后端先 canonicalize 项目根和目标路径，拒绝绝对路径、`..`、根组件以及 symlink 逃逸。
- 前端目录树懒加载，点击目录只展开/收起，不能把目录点击实现为“进入目录”并替换根视图。
- 根目录相对路径必须传空字符串；将根路径本身误传为绝对路径会触发“文件路径必须位于项目目录内”。
- 二进制和超大文件仅展示提示，不在侧栏解码预览。

## 7. 真实 PowerShell 终端

终端不是 Codex 日志，也不是带单行输入框的命令模拟器。

- Rust 使用 `portable-pty` 的 Windows ConPTY 启动普通 `powershell.exe`。
- 不传 `-NoProfile`，保留设备用户的 PowerShell profile 和行为。
- 工作目录设置为当前项目目录；同一项目复用同一个 PTY 会话。
- `powershell_terminal_open`、`powershell_terminal_write`、`powershell_terminal_resize` 负责 PTY 生命周期、字节输入和尺寸同步。
- WebView 使用 xterm.js + fit addon 渲染原始 ANSI 流；必须转发键盘输入、Ctrl+C、滚动缓冲和 resize。
- 切换右侧标签时可以 dispose xterm 视图，但不能关闭项目对应的 PTY；关闭应用时统一关闭。

## 8. 打开位置

`external_open.rs` 只接收当前项目路径，并要求它是存在的绝对目录。可显示的目标由设备实际检测结果决定：

- 文件资源管理器：始终可用。
- VS Code：检测到 `code` 后显示。
- Visual Studio：检测到 `devenv` 后显示。
- Git Bash：检测到 `git-bash` 后显示，并使用 `--cd=<project>`。

不要提供任意可执行命令或任意路径的打开接口。

## 9. UI 约束

- External Agent 是普通聊天的项目化变体，不应形成另一套配色、顶栏或滚动系统。
- 顶栏只保留会话名、连接状态、真实上下文用量和打开位置；模型、推理强度和权限放在 composer。
- 状态只有未连接、已连接、工作中；工作中可以有文本/波纹动效，但不能以“绿灯”掩盖没有任务状态的情况。
- 消息滚动隐藏浏览器原生滚动条，复用普通聊天的定位刻度；用户问题少于两条时隐藏刻度。
- 右侧栏固定为终端、文件、审阅的浏览器标签式工作区；文件树默认可用，审阅来自真实 diff。

## 10. 验证清单

每次修改接入层后至少验证：

1. `cargo check` 与 `node --check ui/js/external-agent-mode.js`。
2. 首次任务是否完成 initialize、model/list、thread/start、turn/start。
3. 新建、切换、重启后恢复 thread，重复连接/断开是否无卡死。
4. 长文本、工具调用、审批、停止、外链打开、上下文更新是否正确。
5. 文件树在未发送任务时可加载；目录展开、文件读取与路径逃逸拦截是否正确。
6. PowerShell 是否是持续的真实会话：命令、`cd`、Ctrl+C、ANSI 颜色和窗口 resize 都要可用。
7. 模型、推理强度、权限和图片输入是否实际进入下一次 `turn/start` 参数。
8. 打开位置只打开当前项目，缺失的程序不显示。
9. Claude Code：首次发送完成 system/init + initialize 握手；`can_use_tool` 三按钮、
   停止（interrupt）、`--resume` 恢复、空闲回收后再发送可透明续接。
10. Pi：首次发送完成 get_state 握手；模型/思考深度切换、abort 停止、
    `--session` 恢复 + get_messages 回放、附件按模型 input 门控、
    权限菜单确认隐藏（不得出现假档位）。
11. 三家运行中都能在输入框追加消息（不打断当前任务），新气泡出现在正确位置；
    独立停止按钮能正常中断且不影响发送键可用性判断。
12. 顶栏连接状态抽屉的"刷新连接"能续上同一会话对话；会话列表右键"终止连接"
    对非当前会话也生效；Codex 终止/刷新时确认弹窗提示"影响全部 Codex 会话"，
    触发后其余 Codex 会话状态一并变化。

## 11. Claude Code stream-json

协议依据与完整映射表在 `docs/claude-code-integration.md`，这里只记已落地口径。

- **进程模型**：一个进程 = 一个会话（与 codex 的单 app-server 不同）。Rust 侧
  `claude_agent.rs` 维护 `sessionKey → 子进程` 池；sessionKey 是 WePChat 会话 id，
  claude 自己的 `session_id`（取自 `system/init`）存在会话数据里，重启进程时用
  `--resume <sessionId>` 恢复上下文。
- **启动**：`claude --print --verbose --input-format stream-json --output-format stream-json
  --include-partial-messages --permission-mode <mode>`，工作目录 = 项目目录；
  Windows 上从 npm shim 定位 `@anthropic-ai/claude-code` 自带的原生 `claude.exe`，
  兜底 `cmd.exe /D /S /C call`。握手在 Rust 内完成：启动后直接发 `initialize` control
  请求（实测启动即应答），`claude_start` 返回 `{initialize}`；`system/init` 要等首条
  用户消息后才出现，`session_id` 由事件流捕获，不得阻塞等待。
- **命令与事件**：`claude_start / claude_send / claude_control（白名单）/ claude_respond /
  claude_stop / claude_stop_all / claude_status`；事件 `claude-agent`，
  载荷 `{ sessionKey, kind: message|controlRequest|status|diagnostic }`，未知消息类型前端一律忽略。
- **权限三档**：请求批准 `default` · 替我批准 `acceptEdits` · 完全访问权限
  `bypassPermissions` + `--dangerously-skip-permissions`；运行中切换用 `set_permission_mode`。
  逐操作审批：`can_use_tool` → `claude_respond` 回 `PermissionResult`；
  「本会话允许」优先采用 CLI 的 session 目标 `permission_suggestions`，
  `destination` 只用 `session`；`suppress_always_allow_rule` 时不提供该按钮。
- **模型与推理档**：模型菜单吃 initialize 响应的 `models`（`ModelInfo`），运行中 `set_model`；
  effort 目前只在下一次进程启动经 `--effort` 生效。
- **上下文与成本**：每次 `result` 后 `get_context_usage` 拉取百分比；
  `result.total_cost_usd` 按会话累计，显示在上下文环 title。
- **变更审阅**：M1 口径，从 `Edit/Write/MultiEdit/NotebookEdit` 的 `tool_use.input`
  合成 diff（按文件聚合）喂现有审阅 UI；`get_workspace_diff` 未接。
- **生命周期**：空闲 10 分钟（无运行轮次且无消息）自动回收进程，之后发送任务时
  `--resume` 透明恢复；窗口关闭 shutdown 全部子进程；会话删除只移除 WePChat 索引，
  不删 `~/.claude/projects/` 下的转录文件。

## 12. Pi --mode rpc

协议依据与完整映射表在 `docs/pi-integration.md`（权威信源：pi 包内 docs/rpc.md），这里只记已落地口径。

- **进程模型**：一个进程 = 一个会话（与 claude 相同）。Rust 侧 `pi_agent.rs` 维护
  `sessionKey → 子进程` 池；pi 自己的 `sessionFile` / `sessionId`（取自 get_state）存在
  会话数据里，重启进程时用 `--session <sessionFile>` 恢复上下文。
- **启动**：`pi --mode rpc [--approve] [--session <file>] [--name <标题>]`，工作目录 =
  项目目录；Windows 上优先 `node <npm 包根>/dist/cli.js` 直启（pi 无原生 exe，直启保证
  kill 干净），兜底 `cmd.exe /D /S /C call pi.cmd`；`--approve` 经 `--version` 门控
  （≥0.79 才传）。握手 = `get_state` 成功，`pi_start` 返回 `{state}`。
- **命令与事件**：`pi_start / pi_request（白名单：prompt、steer、follow_up、abort、
  get_state、get_available_models、set_model、set_thinking_level、get_session_stats、
  set_session_name、get_messages、compact）/ pi_ui_respond / pi_stop / pi_stop_all /
  pi_status`；事件 `pi-agent`，载荷 `{ sessionKey, kind: event|uiRequest|status|diagnostic }`，
  未知事件前端一律忽略。消息三类：命令（带 id）→ 响应（同 id 回填）；事件无 id 异步流。
- **无权限系统**：pi 无沙箱、无权限档、无逐操作审批（security.md 设计取舍），UI 隐藏权限
  菜单，不伪造档位。审批类交互只可能来自用户自装扩展经 extension UI 子协议：
  `select`/`confirm` 复用审批卡，`input`/`editor` 走对话框，`notify` → toast，
  应答用 `pi_ui_respond`（带 timeout 的请求 pi 侧到时自动兜底）。
- **模型与思考深度**：模型菜单吃 `get_available_models`（`provider/id` 双值），运行外
  `set_model` 切换；思考深度是会话级 `set_thinking_level`（off–xhigh，仅
  `Model.reasoning` 为真时显示）。图片附件按当前模型 `Model.input` 含 `image` 门控。
- **流式与步骤**：`message_update` 的 `text_delta` 40ms 合并渲染；
  `tool_execution_start/end` 映射步骤卡；`agent_start/agent_end` 起止 running 态，
  `agent_end` 的 messages 兜底补全正文；停止用 `abort`。
- **上下文与成本**：每次 `agent_end` 后 `get_session_stats`，`contextUsage.percent` 喂
  上下文环，`cost`（会话累计）显示在环 title。
- **变更审阅**：M1 口径，从 `edit`（`edits[]`，兼容顶层 oldText/newText）/`write` 工具的
  args 合成 diff 喂现有审阅 UI。
- **生命周期**：空闲 10 分钟自动回收进程，之后发送任务时 `--session` 透明恢复（本地无
  历史时用 `get_messages` 回放）；窗口关闭 shutdown 全部子进程；会话删除只移除 WePChat
  索引，不删 `~/.pi/agent/sessions/` 下的 JSONL 文件。
- **Windows 前置**：pi 的 bash 工具依赖 Git Bash / MSYS2（pi docs/windows.md）；缺失只影响
  任务内 bash 工具，不影响连接。
