# Claude Code 接入实施方案

状态：**方案，未实施** · 更新时间：2026-07-26
实施后本文并入 / 对齐 `docs/external-agent-integration.md` 的口径（那份只记已落地的事实）。

## 0. 为什么找不到「Claude 版的 app-server 文档」

Claude Code 没有 codex `app-server --stdio` 那样单独成文的 JSON-RPC 协议文档。它的等价物是
**print 模式下的 stdio JSONL 双向流**（`--input-format stream-json --output-format stream-json`），
外加一条复用同一管道的 **control 通道**（`control_request` / `control_response`）。
官方 Agent SDK（TS `@anthropic-ai/claude-agent-sdk`、Python `claude-agent-sdk`）底层就是这条协议；
协议的权威描述以 **TypeScript 类型定义**形式随 npm 包发布（`sdk.d.ts`），相当于"类型即文档"。

本文所有协议细节来自三层可复核的信源（2026-07-26 采集，版本互相配套）：

1. 本机 CLI `claude --help`（**2.1.220**，npm 安装）；
2. 本机真实调用抓包（`-p --input-format stream-json --output-format stream-json` 的原始 JSONL）；
3. `@anthropic-ai/claude-agent-sdk@0.3.220` 的 `sdk.d.ts`（7149 行，wire 协议全量类型）。

官方文档站（docs.claude.com / code.claude.com 的 headless 与 Agent SDK 章节）在当前网络环境无法直连，
联网后可再核对一遍；但以上三层已足够指导实现。

## 1. 结论与风险

- **能力面完整**：我们在 codex 上用到的每一项（模型列表/切换、推理档、权限档、逐操作审批、
  上下文用量、中断、会话重命名、workspace diff）在 claude 侧都有对应 RPC，见 §7 映射总表。
- **协议是开放集合**：消息 type/subtype 会随版本增加，宿主必须**忽略未知消息**；
  没有独立协议版本号，特性检测靠 `system/init` 的 `capabilities` 数组
  （实测含 `interrupt_receipt_v1`、`interrupt_cancel_queued_v1`、`msg_lifecycle_v1`）。
- **进程模型与 codex 不同**：codex 一个 app-server 管全部 thread；claude **一个进程 = 一个会话**。
  Rust 侧要做的是"会话进程池"，不是单连接管理器（§8）。
- **认证跟随用户的 CLI**：subscription OAuth 或 API key / 第三方中转都由用户 claude 自身配置决定，
  我们不碰。报错原样透出（实测本机 relay 返回 400「1m 上下文…」即为一例）。

## 2. 范围与边界（与 codex 同一口径）

- 仅 stream-json RPC；不解析 TUI 输出、不做 PTY 交互式包装。
- 进程按**首次实际发送任务**启动；切页面、看文件树、开终端不得隐式启动 claude。
- 不做 hooks / MCP / skills 配置 UI；不加 `--bare`（它会禁用 OAuth 登录，只剩 API key 认证）；
  默认不改用户 claude 的任何配置，"WePChat 里的 claude 就是用户终端里的那个 claude"。
  排障逃生口（设置里可选，默认关）：`--strict-mcp-config`、`--safe-mode`。
- 会话删除只移除 WePChat 索引，不删 `~/.claude/projects/` 下的转录文件。

## 3. 进程启动

### 3.1 Windows 可执行定位（已在本机验证）

npm 安装的 `claude` 是 `.cmd` shim（`%APPDATA%\npm\claude.cmd`）。**2.x 起 npm 包自带原生 exe**：

```
%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe          ← 首选
%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\node_modules\
  @anthropic-ai\claude-code-win32-x64\claude.exe                             ← 平台包备选
```

与 `codex_native_binary` 同一策略：从 shim 所在目录探测真实 exe，直接作为长驻子进程；
兜底才走 `cmd.exe /D /S /C call` 包装。另有 `claude install` 原生安装方式（本机未装，
实施时用 `claude doctor` 确认其安装路径后补充探测点）。

### 3.2 启动命令（每会话一个进程）

```
claude --print --verbose \
  --input-format stream-json --output-format stream-json \
  --include-partial-messages \
  --permission-mode <mode> \
  [--model <id|别名>] [--effort low|medium|high|xhigh|max] \
  [--resume <sessionId> | 无（新会话）] \
  [--dangerously-skip-permissions]           # 仅「完全访问」档
```

要点（均实测/类型确认）：

- `--verbose` 是 stream-json 输出的**硬性前置**，缺了直接报错退出。
- 工作目录 = 项目目录（`Command::current_dir`），文件/权限范围随 cwd；跨目录再谈 `--add-dir`。
- 新会话**不传** `--session-id`，从首条 `system/init` 里取 `session_id` 存入 WePChat 索引；
  恢复历史会话用 `--resume <sessionId>`（进程重启后上下文由 CLI 自己从转录恢复）。
- 转录存储：`~/.claude/projects/<cwd-slug>/<session_id>.jsonl`（slug 如 `E--wepchat-wepchat`）。
- 权限档 UI 三档 → CLI `--permission-mode`（六档取三）：

  | WePChat UI | Claude CLI | 说明 |
  | --- | --- | --- |
  | 请求批准 | `default` | 危险操作弹 `can_use_tool` 审批 |
  | 替我批准 | `acceptEdits` | 自动接受文件编辑，其余仍审批 |
  | 完全访问权限 | `bypassPermissions` + `--dangerously-skip-permissions` | 待实测：单 mode 是否要求另一 flag 放行（类型注释称 requires allowDangerouslySkipPermissions） |

  另有 `plan` / `dontAsk` / `auto` 三档，UI 暂不暴露；`auto`（分类器自动批）可作为
  「替我批准」的后续增强项。

## 4. 出站消息（CLI → 宿主）

每行一个 JSON。宿主按 `type`（部分再看 `subtype`）分发，**未知类型一律忽略**。
以下样例为本机抓包精简（省略部分字段）：

```jsonc
// ① 握手：进程起来后第一条
{"type":"system","subtype":"init","cwd":"...","session_id":"0dc04121-...",
 "tools":["Bash","Edit","Read", ...],"model":"claude-opus-4-7","permissionMode":"default",
 "claude_code_version":"2.1.220","capabilities":["interrupt_receipt_v1", ...],
 "mcp_servers":[...],"slash_commands":[...],"apiKeySource":"none"}

// ② 轮次状态
{"type":"system","subtype":"status","status":"requesting","session_id":"..."}

// ③ 助手消息（完整 Anthropic message；流式时最终态）
{"type":"assistant","session_id":"...","parent_tool_use_id":null,
 "message":{"role":"assistant","model":"...","content":[
   {"type":"text","text":"..."},
   {"type":"tool_use","id":"toolu_x","name":"Edit","input":{"file_path":"...","old_string":"..."}}
 ],"usage":{"input_tokens":123,"output_tokens":45,"cache_read_input_tokens":0, ...}}}
// API 错误会以合成 assistant 出现：model:"<synthetic>"、"is_api_error_message":true → 渲染为错误行

// ④ 增量流（--include-partial-messages）：标准 Anthropic 流事件原样转发
{"type":"stream_event","session_id":"...","parent_tool_use_id":null,
 "event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"…"}}}

// ⑤ 工具结果回流（role:user 的 tool_result；tool_use_result 为结构化结果）
{"type":"user","session_id":"...","message":{"role":"user","content":[
   {"type":"tool_result","tool_use_id":"toolu_x","content":"..."}]},"tool_use_result":{...}}

// ⑥ 轮次收尾（= codex turn/completed + tokenUsage 合体）
{"type":"result","subtype":"success","is_error":false,"num_turns":1,"session_id":"...",
 "duration_ms":182,"total_cost_usd":0.0031,"usage":{...},"modelUsage":{"claude-…":{
   "inputTokens":…,"costUSD":…,"contextWindow":200000, ...}},
 "permission_denials":[],"result":"最终文本"}

// ⑦ 服务端控制请求（审批等，见 §6）
{"type":"control_request","request_id":"...","request":{"subtype":"can_use_tool", ...}}

// ⑧ 宿主控制请求的应答
{"type":"control_response","response":{"subtype":"success","request_id":"...","response":{...}}}
// 失败：{"subtype":"error","request_id":"...","error":"..."}
```

UI 映射：`tool_use` 块 → 工具步骤卡（名称映射：`Bash`→运行命令、`Edit/Write/MultiEdit/NotebookEdit`→
修改文件、`Read/Glob/Grep`→读取检索、`Task`→子代理、`WebFetch/WebSearch`→访问网络、其余显示原名）；
`tool_result` 到达 → 对应步骤置完成；`result` → 清 running 态；`total_cost_usd`/`usage` → 元信息。

## 5. 入站消息（宿主 → CLI stdin）

```jsonc
// 发送任务（= codex turn/start）。content 是标准 Anthropic content blocks
{"type":"user","message":{"role":"user","content":[
  {"type":"text","text":"任务描述"},
  {"type":"image","source":{"type":"base64","media_type":"image/png","data":"<base64>"}}
]},"parent_tool_use_id":null}

// 宿主控制请求（信封统一；request_id 宿主生成、宿主唯一）
{"type":"control_request","request_id":"wc-1","request":{"subtype":"interrupt","cancel_queued":true}}
{"type":"control_request","request_id":"wc-2","request":{"subtype":"set_permission_mode","mode":"acceptEdits"}}
{"type":"control_request","request_id":"wc-3","request":{"subtype":"set_model","model":"claude-sonnet-5"}}   // 省略/null = 回默认
{"type":"control_request","request_id":"wc-4","request":{"subtype":"set_max_thinking_tokens","max_thinking_tokens":8192}}
{"type":"control_request","request_id":"wc-5","request":{"subtype":"rename_session","title":"新标题"}}
{"type":"control_request","request_id":"wc-6","request":{"subtype":"get_context_usage"}}
{"type":"control_request","request_id":"wc-7","request":{"subtype":"list_models"}}
{"type":"control_request","request_id":"wc-8","request":{"subtype":"get_workspace_diff"}}
{"type":"control_request","request_id":"wc-9","request":{"subtype":"get_session_cost"}}

// 应答 CLI 的 can_use_tool（见 §6）
{"type":"control_response","response":{"subtype":"success","request_id":"<CLI 给的 id>","response":{<PermissionResult>}}}

// 撤销自己发出的未决控制请求
{"type":"control_cancel_request","request_id":"wc-6"}
```

**initialize 握手**：进程起来、收到 `system/init` 后，宿主发一次
`{"subtype":"initialize"}`（空参即可，SDK 同款行为）。响应即含
`commands`、`models: ModelInfo[]`、`account`，以及 **`pending_permission_requests`**
（resume 一个还挂着审批的会话时，靠它恢复审批卡）。模型菜单直接吃这里的 `models`，
无需单独 `list_models`（后者留作刷新）。

`ModelInfo`：`value`（发请求用）/ `displayName` / `description` / `supportsEffort` /
`supportedEffortLevels` —— 正好填现有模型菜单 + 推理档子菜单，结构与 codex `model/list` 对齐。

## 6. 逐操作审批（can_use_tool）

CLI 需要授权时，**暂停工具执行**并发：

```jsonc
{"type":"control_request","request_id":"<cli-id>","request":{
  "subtype":"can_use_tool",
  "tool_name":"Bash",
  "input":{"command":"npm test"},
  "permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"npm test"}],
                             "behavior":"allow","destination":"session"}],   // 可选
  "decision_reason":"…为何升级为人工审批…",          // 可能含 ANSI 转义，渲染前清洗
  "decision_reason_type":"safetyCheck",             // rule|mode|safetyCheck|classifier|…
  "suppress_always_allow_rule":false                 // true 时不得提供「本会话允许」入口
}}
```

宿主回 `control_response`，`response` 字段放 `PermissionResult`，三个按钮映射：

| UI 按钮 | PermissionResult |
| --- | --- |
| 允许一次 | `{"behavior":"allow","updatedInput":<原 input 原样回传>}` |
| 本会话允许 | allow + `"updatedPermissions":[{"type":"addRules","rules":[{"toolName":"<tool_name>"}],"behavior":"allow","destination":"session"}]`（有 `permission_suggestions` 时优先原样采用其中 session 目标的建议） |
| 拒绝 | `{"behavior":"deny","message":"用户拒绝了此操作"}`（如需连轮次一起停，加 `"interrupt":true`） |

注意：`destination` 只用 `"session"`，不写入用户 settings 文件（边界 §2）。
被规则/dontAsk 自动拒绝的操作不会弹审批，而是出 `permission_denied` 类事件与
`result.permission_denials`，渲染为步骤卡上的「已拒绝」态即可。

## 7. UI 功能 ↔ 协议映射总表

| WePChat 功能 | Codex 用法 | Claude Code 用法 |
| --- | --- | --- |
| 连接状态 | initialize 握手 | 进程存活 + `system/init` 已收到 |
| 模型菜单 | `model/list` | initialize 响应 `models`（刷新用 `list_models`） |
| 切换模型 | turn 参数 `model` | `set_model`（运行中即可切，后续轮次生效） |
| 推理/思考档 | turn 参数 `effort` | 启动 `--effort`；运行中 `set_max_thinking_tokens`（M3 实测两者关系后定 UI 行为） |
| 权限档 | approvalPolicy + sandboxPolicy | 启动 `--permission-mode`；运行中 `set_permission_mode` |
| 逐操作审批 | `item/*/requestApproval` → `codex_respond` | `can_use_tool` → `control_response`（§6） |
| 发送任务 | `turn/start` | stdin 写 user 消息（§5） |
| 停止 | `turn/interrupt` | `interrupt`（带 `cancel_queued:true`，一次停干净） |
| 流式正文 | `item/agentMessage/delta` | `stream_event` 的 `text_delta`（thinking_delta 进折叠思考区） |
| 工具步骤卡 | `item/started` / `item/completed` | `tool_use` 块 / `tool_result` 回流（§4） |
| 上下文用量环 | `thread/tokenUsage/updated` 推送 | `get_context_usage` 拉取：响应含 `totalTokens`/`maxTokens`/`percentage`，直接喂 `--external-context`；每次 `result` 后调一次即可 |
| 变更审阅 | `turn/diff/updated` + fileChange | M1：从 `Edit/Write` 的 `tool_use.input` 积累 changes 喂现有审阅 UI；增强：`get_workspace_diff`（git 底、5s/50 文件/1MB 上限；响应体在 sdk.d.ts 中未定型，实施时实测） |
| 会话重命名 | `thread/name/set` | `rename_session` |
| 会话恢复 | `thread/resume` | 重启进程 `--resume <id>`，恢复未决审批看 initialize 的 `pending_permission_requests` |
| 图片附件 | turn input `type:image` | user 消息 content 里的 `image` block（base64，直接用现有 composerAttachments 的 dataUrl） |
| 成本显示 | 无 | `result.total_cost_usd`（会话累计用 `get_session_cost`） |

## 8. Rust 层设计（新增 `claude_agent.rs`）

```text
ClaudeAgent {  sessions: Mutex<HashMap<String /*sessionKey*/, Arc<ClaudeConnection>>>  }
ClaudeConnection { child, stdin, alive, pending: HashMap<String /*request_id*/, mpsc::Sender> }
```

- **sessionKey** 用 WePChat 自己的会话 id；`session_id`（claude 的）存在会话数据里做 `--resume`。
- stdout 逐行解析：
  - `control_response` 且 `request_id` 命中 pending → 回填等待者（复刻 codex 的 pending map，
    30s 超时；差异仅在 id 是宿主生成的字符串）；
  - 其余（含 `control_request`、全部消息流）原样 emit 到 WebView：
    事件名 `claude-agent`，载荷 `{ sessionKey, kind: "message"|"controlRequest"|"status"|"diagnostic", message }`；
  - stderr → diagnostic（保留最近 20 行用于启动失败提示，同 codex）。
- Tauri 命令（与 codex 命令一一对应）：
  `claude_start(sessionKey, cwd, resumeId?, model?, effort?, permissionMode)` /
  `claude_send(sessionKey, message)`（user 消息） /
  `claude_control(sessionKey, subtype, params)`（**白名单**：interrupt、set_permission_mode、
  set_model、set_max_thinking_tokens、rename_session、get_context_usage、get_session_cost、
  list_models、get_workspace_diff、initialize） /
  `claude_respond(sessionKey, requestId, result)`（审批应答） /
  `claude_stop(sessionKey)` / `claude_status()`。
- 生命周期：窗口关闭 shutdown 全部子进程（并入现有 `lib.rs` 退出钩子）；
  空闲回收：无运行轮次且 N 分钟（建议 10）无消息 → kill，之后 `--resume` 透明恢复。
- 设置复用 `externalConnections.agents.claude`（commandPath / extraArgs / env），
  检测复用 `external_agent_detect`。

## 9. 前端接入（external-agent-mode.js）

在现有 codex 分支旁加 claude 适配层，渲染层零新增（全部复用统一重构后的组件）：

- `sendMessage()` 增加 claude 分支：起进程（若未启动）→ initialize → 写 user 消息；
  running/审批/步骤/changes 状态机与 codex 分支同构。
- `handleClaudeMessage()`：按 §4 映射到 `ensureCodexAssistant` 同款的消息聚合逻辑
  （建议把这套聚合改名为 agent 通用工具函数后共用）。
- 模型菜单/权限菜单/上下文环/停止按钮：走 §7 的对应 RPC，UI 组件不变。
- Pi 仍为 mock 占位，不受影响。

## 10. 实施顺序与验证

1. **M1 连接与对话**：启动/握手/发送/流式渲染/停止/进程回收。验证：真实任务往返、
   中断后发送键状态恢复、kill 进程后 UI 显示断开。
2. **M2 审批与权限**：can_use_tool 三按钮、权限档切换、permission_denials 展示。
   验证：default 档触发 Bash 审批；suppress_always_allow_rule 时无「本会话允许」。
3. **M3 模型与用量**：模型菜单、set_model、effort 档、上下文环、成本。
4. **M4 会话管理**：resume、rename、图片附件、diff 审阅增强。

### 写代码前的实测清单（本机即可完成）

- [ ] `bypassPermissions` 是否必须搭配 `--allow-dangerously-skip-permissions`
- [ ] `get_workspace_diff` 响应实际字段
- [ ] `set_max_thinking_tokens` 与启动 `--effort` 的相互作用
- [ ] `--resume` + 未决审批 → `pending_permission_requests` 行为
- [ ] 长任务下 stream_event 吞吐与 UI 渲染节流（复用聊天模式 40ms 合并即可）
