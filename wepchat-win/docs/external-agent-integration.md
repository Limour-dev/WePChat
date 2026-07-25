# External Agent 接入经验

更新时间：2026-07-25

本文记录 WePChat Windows 当前已落地的 External Agent 接入方式。它是后续维护 Codex 集成时的唯一工程说明，不记录已废弃的 ACP、`codex exec --json`、演示终端或 mock 方案。

## 1. 当前范围

- Codex 是唯一真实接入的外部 Agent；Pi 与 Claude Code 保留为 UI 占位，不得伪装为已连接。
- 连接协议是 Codex CLI 的 `app-server --stdio` JSON-RPC JSONL。
- 进程按首次实际发送任务启动；切换到 External Agent 页面、查看文件树或打开终端都不得隐式启动 Codex。
- 每个项目下可有多个 Codex thread；文件、终端与打开位置均以当前项目目录为范围。

## 2. 分层

```text
WebView
  external-agent-mode.js
    -> Tauri invoke / event
Rust
  external_agent.rs     Codex app-server 生命周期与 JSONL RPC
  external_project.rs   只读项目文件树与文件内容
  external_terminal.rs  Windows ConPTY + 真 PowerShell
  external_open.rs      当前项目的受限外部打开方式
    -> Codex CLI / Windows process
```

`src-tauri/src/lib.rs` 必须同时注册上述命令，并在窗口关闭时调用 `CodexAppServer::shutdown()` 与 `PowerShellTerminal::shutdown()`，避免遗留子进程。

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
