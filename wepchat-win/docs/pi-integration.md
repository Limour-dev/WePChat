# Pi 接入实施方案

状态：**已实施（2026-07-26，M1–M4 主体落地）** · 更新时间：2026-07-26
已落地事实以 `docs/external-agent-integration.md` §12 为准；本文保留协议依据、映射表与实测清单，末尾附实施记录。

## 0. 信源（全部本机可复核，2026-07-26 采集）

1. 本机 CLI `pi 0.80.2`（npm `@earendil-works/pi-coding-agent`，shim `%APPDATA%\npm\pi.cmd`）；
2. **官方 RPC 协议文档随包发布**：`node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`
   （1412 行，命令/事件/类型全量），另有 `sessions.md`、`security.md`、`windows.md`、`session-format.md`；
3. 参考实现 `example/PiDesktop`（Electron 版桌面壳，重点 `src/main/pi/`：
   `PiProcess.ts`、`PiRpcClient.ts`、`PiLocator.ts`、`AgentManager.ts`）；
4. 本机零成本探测 `scripts/probe-pi-rpc.cjs`：`get_state` / `get_commands` 实测通过
   （当前默认模型为用户自配 provider `codex2api/gpt-5.5`，`input: ["text"]`）。

相比 codex / claude，pi 是三家里协议最简单、文档最完整的：不需要抓包反推，`rpc.md` 即权威。

## 1. 结论与风险

- **协议形态**：`pi --mode rpc` 的 stdin/stdout JSONL。三类消息：
  **命令**（宿主→pi，带可选 `id`）、**响应**（`type:"response"`，回带同 `id`）、
  **事件**（pi→宿主，无 `id`，异步流）。不存在 codex 式 server-request，也没有 claude 式 control 信封。
- **进程模型与 claude 相同**：一个进程 = 一个会话（PiDesktop 同款）。复用 `claude_agent.rs`
  的会话进程池骨架即可，差异只在消息分发规则。
- **没有权限系统**：pi 无内建沙箱、无权限档、无逐操作审批（`security.md` 明说这是设计取舍）。
  UI 上 pi **不显示权限三档菜单**；审批类交互只可能来自用户自装扩展经
  extension UI 子协议（`select`/`confirm` 弹窗，§6）。不得伪造"请求批准"档。
- **严格 JSONL 框架**：只认 LF 分隔，需容忍尾部 `\r`；文档特别警告 Node `readline`
  不合规（会按 U+2028/U+2029 分行）。Rust `BufRead::lines` 按 `\n` 切分并去 `\r`，天然合规。
- **无原生 exe**：包入口是 `dist/cli.js`（纯 Node）。长驻子进程优先
  `node <包根>/dist/cli.js` 直启（kill 干净），兜底 `cmd.exe /D /S /C call pi.cmd`。
- **Windows 前置**：pi 的 bash 工具需要 Git Bash / MSYS2 等（`windows.md`）；缺失时任务里
  bash 工具会报错，不影响连接本身。检测（`external_agent_detect`）时可附带提示。
- **认证/模型跟随用户 pi 配置**：provider、api key、模型清单全部来自用户 `~/.pi` 配置，
  我们只读 `get_available_models` / `get_state`，不碰配置。
- **图片输入按模型能力门控**：`Model.input` 含 `"image"` 才放开附件按钮
  （本机当前默认模型 gpt-5.5 仅 text）。

## 2. 范围与边界（与 codex / claude 同一口径）

- 仅 `--mode rpc`；不解析 TUI、不做 PTY 包装。
- 进程按首次实际发送任务启动；切页面/看文件树/开终端不得隐式启动 pi。
- 项目信任：非交互模式不弹 trust 提示，默认 `"ask"` 会**忽略**项目级扩展/设置。
  启动加 `--approve`（0.79+ 引入；本机 0.80.2 满足，启动前按 PiDesktop 方式做一次
  `--version` 主版本探测，低版本不传）以信任当前项目目录，行为与用户在终端里选"信任"一致。
- 不做扩展/技能管理 UI；`/命令` 透传（prompt 消息以 `/` 开头即扩展命令，pi 自己展开）。
- 会话删除只移除 WePChat 索引，不删 `~/.pi/agent/sessions/` 下的 JSONL 文件。

## 3. 进程启动

```
node <npm-root>/@earendil-works/pi-coding-agent/dist/cli.js \
  --mode rpc \
  [--approve]                 # 0.79+，覆盖项目信任
  [--session <sessionFile>]   # 恢复历史会话（绝对路径）
  [--name <标题>]             # 新会话初始名
```

- 可执行定位：从 `pi` shim（`where pi`）推出包根 `…\npm\node_modules\@earendil-works\pi-coding-agent`，
  入口 `dist/cli.js`，用 PATH 里的 `node` 直启；找不到 node 或包根时退回 cmd 包装 shim。
  用户在设置里手填 `commandPath` 时优先（复用 `externalConnections.agents.pi`）。
- 工作目录 = 项目目录（pi 以 cwd 分组会话、发现 AGENTS.md）。
- **不传** `--provider/--model/--thinking`：跟随用户默认，连上后用 RPC 查询/切换。
- 新会话：启动后发 `get_state` 拿 `sessionFile` / `sessionId` / `model` / `thinkingLevel`
  存入 WePChat 索引；恢复会话用 `--session <sessionFile>`。
- 会话存储：`~/.pi/agent/sessions/`（按 cwd 分组的 JSONL 树）。

## 4. 命令（宿主 → pi stdin）

实际会用到的子集（完整清单见 rpc.md）：

```jsonc
{"id":"wc-1","type":"prompt","message":"任务描述","images":[{"type":"image","data":"<base64>","mimeType":"image/png"}]}
// 运行中必须带 streamingBehavior，否则报错：
{"id":"wc-2","type":"prompt","message":"补充指示","streamingBehavior":"steer"}   // 或 "followUp"
{"id":"wc-3","type":"abort"}
{"id":"wc-4","type":"get_state"}            // model/thinkingLevel/isStreaming/sessionFile/sessionId/sessionName
{"id":"wc-5","type":"get_available_models"} // Model[]
{"id":"wc-6","type":"set_model","provider":"anthropic","modelId":"..."}
{"id":"wc-7","type":"set_thinking_level","level":"high"}   // off|minimal|low|medium|high|xhigh
{"id":"wc-8","type":"get_session_stats"}    // tokens/cost/contextUsage{tokens,contextWindow,percent}
{"id":"wc-9","type":"set_session_name","name":"新标题"}
{"id":"wc-10","type":"get_messages"}        // resume 后回放历史
{"id":"wc-11","type":"compact"}             // 增强项：手动压缩上下文
```

响应统一 `{"id","type":"response","command","success",("data"|"error")}`。
`prompt` 的 `success:true` 只表示已接受/入队；执行期失败走事件流，不会二次响应同一 id。

## 5. 事件（pi stdout → 宿主）

| 事件 | UI 映射 |
| --- | --- |
| `agent_start` / `agent_end` | 轮次 running 态起止（`agent_end` 带全部生成消息，可兜底补全） |
| `turn_start` / `turn_end` | 单个 assistant 回合；`turn_end` 带完整消息与工具结果 |
| `message_update` | 流式增量：`assistantMessageEvent.type` 为 `text_delta`（正文）/ `thinking_delta`（思考区）/ `toolcall_*` |
| `tool_execution_start` | 工具步骤卡新增（`toolCallId` 关联；内建工具 read / bash / edit / write） |
| `tool_execution_update` | 步骤进行中输出（**累计全量**，直接替换显示，无需拼接） |
| `tool_execution_end` | 步骤置完成 / `isError` 置失败 |
| `queue_update` | steer / followUp 排队提示（增强项） |
| `compaction_start/end` | 压缩提示（增强项） |
| `auto_retry_start/end` | 显示为状态行"重试中 n/m"；`auto_retry_end.success:false` 时把 `finalError` 渲染为错误行 |
| `extension_error` | diagnostic |
| `extension_ui_request` | 见 §6 |

未知事件一律忽略（协议开放集合，与 codex/claude 同规矩）。

## 6. extension UI 子协议（pi 版"审批"）

pi 本体不产生审批，但扩展可经 `ctx.ui.*` 请求交互，RPC 模式下翻译为：

```jsonc
// 对话类（select/confirm/input/editor）：阻塞等待宿主应答，id 必须回带
{"type":"extension_ui_request","id":"uuid-1","method":"select","title":"Allow dangerous command?","options":["Allow","Block"],"timeout":10000}
// 应答（stdin）：
{"type":"extension_ui_response","id":"uuid-1","value":"Allow"}        // select/input/editor
{"type":"extension_ui_response","id":"uuid-2","confirmed":true}       // confirm
{"type":"extension_ui_response","id":"uuid-3","cancelled":true}       // 任意对话类的取消
// 通知类（notify/setStatus/setWidget/setTitle/set_editor_text）：只播报，不应答
```

UI 复用现有审批卡：`select` → 选项按钮组；`confirm` → 确认/取消双按钮；
`input`/`editor` → 走 `UIDialog.prompt`。带 `timeout` 的请求 pi 侧到时自动兜底，宿主无需计时。
`notify` → toast；其余通知类忽略（M1 可全部忽略对话类之外的方法）。

## 7. UI 功能 ↔ 协议映射总表

| WePChat 功能 | Codex | Claude | **Pi** |
| --- | --- | --- | --- |
| 连接状态 | initialize 握手 | 进程存活 + initialize | 进程存活 + `get_state` 成功 |
| 模型菜单 | `model/list` | initialize `models` | `get_available_models`；当前值 `get_state.model` |
| 切换模型 | turn 参数 | `set_model` | `set_model {provider, modelId}` |
| 推理/思考档 | turn 参数 `effort` | 启动 `--effort` | `set_thinking_level`（运行外随时切，`get_state.thinkingLevel` 回显） |
| 权限档 | approvalPolicy+sandbox | `--permission-mode` | **无，隐藏菜单**（§1） |
| 逐操作审批 | requestApproval | `can_use_tool` | 仅 `extension_ui_request`（§6，取决于用户扩展） |
| 发送任务 | `turn/start` | stdin user 消息 | `prompt`；运行中追加 → `streamingBehavior: steer/followUp` |
| 停止 | `turn/interrupt` | `interrupt` | `abort` |
| 流式正文 | agentMessage/delta | `stream_event` | `message_update` `text_delta`（`thinking_delta` 进思考区） |
| 工具步骤卡 | item/started/completed | `tool_use`/`tool_result` | `tool_execution_start/update/end` |
| 上下文用量环 | tokenUsage 推送 | `get_context_usage` 拉 | `get_session_stats.contextUsage.percent`（每次 `agent_end` 后拉） |
| 变更审阅 | `turn/diff/updated` | M1 合成 diff | 同 claude M1 口径：从 `edit`/`write` 工具的 `args` 合成 |
| 会话重命名 | `thread/name/set` | `rename_session` | `set_session_name`（启动初名 `--name`） |
| 会话恢复 | `thread/resume` | `--resume <id>` | 重启进程 `--session <sessionFile>`；历史回放 `get_messages` |
| 图片附件 | turn input image | image block | `prompt.images`（按 `Model.input` 含 `image` 门控） |
| 成本显示 | 无 | `result.total_cost_usd` | `get_session_stats.cost`（还有分项 tokens） |
| 上下文压缩 | 无 | 无 | `compact` / `set_auto_compaction`（pi 独有，增强项） |

## 8. Rust 层设计（新增 `pi_agent.rs`，复刻 `claude_agent.rs` 骨架）

```text
PiAgent { sessions: Mutex<HashMap<String /*sessionKey*/, Arc<PiSession>>> }
PiSession { child, stdin, alive, busy, last_activity,
            pending: HashMap<String /*id*/, mpsc::Sender> }
```

- stdout 逐行（strip `\r`）解析：
  - `type=="response"` 且 `id` 命中 pending → 回填等待者（30s 超时，宿主生成 `wc-N` id）；
  - `type=="extension_ui_request"` → emit `kind:"uiRequest"`；
  - 其余事件原样 emit `kind:"event"`；解析失败 → diagnostic（保留 stderr 尾部 20 行）。
- busy 判定：`agent_start` → true，`agent_end` → false（供 10 分钟空闲回收，同 claude）。
- Tauri 命令：`pi_start(sessionKey, cwd, sessionFile?, name?)`（内部 `get_state` 校验并返回其 data）/
  `pi_request(sessionKey, command, params)`（**白名单**：§4 列出的子集）/
  `pi_ui_respond(sessionKey, requestId, payload)` / `pi_stop` / `pi_stop_all` / `pi_status`。
- 事件名 `pi-agent`，载荷 `{ sessionKey, kind: "event"|"uiRequest"|"status"|"diagnostic", … }`。
- 窗口关闭并入现有退出钩子；设置复用 `externalConnections.agents.pi`。

## 9. 前端接入（external-agent-mode.js）

- `isLiveKind` 加入 pi；发送/流式/步骤/停止状态机与 claude 分支同构（三分支后值得把
  消息聚合抽成 agent 通用工具，方案阶段先复制）。
- pi 分支差异：权限菜单隐藏；模型菜单双值（provider+modelId）；推理档独立于模型菜单
  （pi 是会话级 thinkingLevel，不是模型参数）；附件按钮按当前模型 `input` 能力禁用；
  resume 后用 `get_messages` 回放历史消息（codex/claude 目前靠 WePChat 本地索引，pi 可两者并用）。
- `extension_ui_request` → 审批卡/对话框映射见 §6。

## 10. 实施顺序与实测清单

1. **M1 连接与对话**：直启 cli.js、get_state、prompt、流式、abort、空闲回收。
2. **M2 模型与用量**：模型菜单、set_model、thinking 档、上下文环、成本。
3. **M3 会话管理**：--session 恢复 + get_messages 回放、set_session_name、图片门控。
4. **M4 交互增强**：extension_ui 对话类、steer/followUp 入口、compact。

写代码前实测（本机零成本即可）：

- [x] `--approve` 在 0.80.2 非交互模式下可用（`--help` 确认 `-a, --approve`；`--mode rpc --approve` 启动正常）
- [x] `node dist/cli.js` 直启与 `pi.cmd` 包装在长驻/kill 行为上的差异
  （`scripts/probe-pi-resume.cjs` 实测：node 直启 get_state ~4s 应答，kill 干净退出；作为首选路径落地）
- [x] `--session` 恢复后 `get_messages` 的消息结构（返回 active path 的 `AgentMessage[]`：
  user 的 content 可为字符串或块数组，assistant 为 `text|thinking|toolCall` 块，另有 `toolResult` 角色）
- [x] `tool_execution_update` 高频输出的吞吐：M1 未渲染 update 增量（步骤卡只在 start/end 变化），
  正文流式沿用 40ms 合并渲染，吞吐无压力；接 update 时复用同一节流即可
- [x] 运行中 `prompt` 不带 `streamingBehavior` 的报错口径：rpc.md L65 明确返回 response error。
  WePChat 的发送键在 running 态即停止键（与 codex/claude 一致），M1 不触发该路径；
  steer/followUp 入口留作 M4 增强（Rust 白名单已放行 `steer`/`follow_up`）

## 11. 实施记录（2026-07-26）

代码落点：

- Rust：新增 `src-tauri/src/pi_agent.rs`（会话进程池，§8 设计原样落地）。
  命令 `pi_start / pi_request（白名单）/ pi_ui_respond / pi_stop / pi_stop_all / pi_status`；
  事件 `pi-agent`，载荷 `{ sessionKey, kind: event|uiRequest|status|diagnostic, … }`；
  白名单为 §4 子集 + `steer`/`follow_up`（备 M4）；空闲回收 10 分钟；窗口关闭
  `PiAgent::shutdown_all()`（`lib.rs`）。启动优先 `node <包根>/dist/cli.js` 直启，
  兜底 cmd 包装 shim；`--approve` 经 `--version` 门控（≥0.79 才传）；
  握手 = `get_state` 成功，`pi_start` 返回 `{state}`（sessionFile/sessionId/model/thinkingLevel）。
  `external_agent.rs` 的 `version_of` 改为 `pub(crate)` 供复用。
- 前端：`ui/js/external-agent-mode.js` 增加 pi 分支，渲染层零新增（§9 口径）。
  - 发送/流式/步骤/停止状态机与 claude 分支同构：`prompt` 发送、`message_update.text_delta`
    40ms 合并渲染、`tool_execution_start/end` 步骤卡、`abort` 停止、`agent_end` 兜底补全正文
    （含 `errorMessage` 错误行）、`auto_retry_end.success:false` 渲染 `finalError`。
  - 权限菜单对 pi 隐藏（无权限系统，不伪造档位）；模型菜单双值 `provider/id`
    （`get_available_models` + `set_model`）；思考深度独立区块（会话级 `set_thinking_level`，
    off|minimal|low|medium|high|xhigh，仅 `Model.reasoning` 为真时显示）；
    附件按钮按当前模型 `Model.input` 含 `image` 门控。
  - 会话：首次发送 `--name` 起名 + `set_session_name` 跟随重命名；重启进程用
    `--session <sessionFile>` 恢复；resume 后本地无历史（只有刚输入的一轮）时
    `get_messages` 回放并前插；删除会话只移除 WePChat 索引。
  - extension UI 子协议：`select`/`confirm` 复用审批卡（选项按钮组 / 确认取消），
    `input`/`editor` 走 `UIDialog.prompt`，`notify` → toast，其余通知类忽略；
    `agent_end` 时自动关闭未决卡片（pi 侧 timeout 自行兜底）。
  - 上下文环/成本：每次 `agent_end` 后 `get_session_stats`，
    `contextUsage.percent` 喂环、`cost`（会话累计）显示在环 title。
  - 变更审阅走 M1 口径：`edit`（`edits[]`，兼容顶层 oldText/newText）/`write` 的 args 合成 diff。
  - 顺手清理：pi 转真实连接后删除 mock 残留（`sendMockMessage`、`mockReviews`、
    `responseTimer`、`isLiveKind`）；旧 pi mock 数据经 `rpcReady` 标记一次性重置。

### 追加：任务中发送消息 + 断开/刷新连接（2026-07-26）

- `sendPiMessage()` 现按 `session.running` 分叉：运行中调用 `steer` 命令（`prompt` 保留给
  新任务），新 user 气泡插入到当前流式 assistant 气泡之前（`insertRunningUserMessage`
  共享助手，claude/codex 同款）。composer 改为独立的发送/停止双按钮
  （`#external-send`/`#external-stop`），发送键不再兼职停止键。
- 顶栏连接状态改为可点击的 button，展开抽屉可「刷新连接」（`pi_stop` 后用已存的
  `session.piSessionFile` 经 `ensurePiSession` 重新 `--session` 恢复）/「终止连接」
  （`pi_stop`，只影响这一个会话）；左侧会话列表行右键菜单同样提供「终止连接」。
- `follow_up` 与 `compact`/`queue_update`/`compaction_*` UI 仍留作后续增强。

与方案的偏差 / 留待后续：

- `tool_execution_update` 增量未渲染（步骤卡只有 start/end 两态），`queue_update`/
  `compaction_*` 提示与 `compact` 手动压缩入口未接 UI（Rust 白名单已放行 `compact`）；
  `follow_up` 入口未做（steer 已接通道）。
- `thinking_delta` 未渲染（与 claude 同口径，折叠思考区留作增强）。
- resume 回放只在「本地无历史」时触发；本地已有索引时不做两边合并。
- Windows 前置提示（Git Bash 缺失时 bash 工具报错）未在检测里附带说明。
