# Kivio 外部 Agent 调研与后续接入建议

更新时间：2026-07-27

本文只比较 Kivio 与 WePChat 的 Claude Code、Codex、Pi 接入，并记录 Grok CLI、OpenCode 的后续接入方向。Kivio 是实现参考，不是协议权威；正式开发仍应以目标 CLI 版本的帮助、协议文档和真实握手结果为准。

## 1. 结论

Kivio 的 Claude、Codex、Pi 会话实现没有值得整体迁移到 WePChat 的独特架构。WePChat 已经使用各 CLI 的原生长连接协议，并且保留了更完整的会话 UI、审批、追加消息、刷新连接和项目工作区能力。

仍有四项可明显改善 WePChat 的桌面端体验：

1. **统一后台进程创建入口**：Kivio 用同一个 `NoConsoleWindow` trait 覆盖 `std::process::Command` 和 `tokio::process::Command`。WePChat 的 `CREATE_NO_WINDOW` 修复已经覆盖三家 Agent，但后续最好把所有 CLI、MCP、`where` 探测都收敛到共享 helper，避免新增调用点再次弹终端。
2. **刷新 GUI 进程的 PATH**：Windows GUI 可能继承 Explorer 的旧 PATH。Kivio 启动时合并进程 PATH、注册表中的用户/系统 PATH、常见安装目录，并以超时保护读取 PowerShell profile PATH，可解决“终端能运行 CLI，应用里检测不到”的问题。
3. **检测分层和缓存**：将便宜的“可执行文件是否存在、版本、登录状态”与昂贵的“启动协议并探测模型”分开。Agent 列表只做前者；用户选中 Agent/模型菜单时才按 `agent + cwd` 懒加载模型，并对并发请求 single-flight。
4. **全局限制长驻进程数量**：Kivio 除 10 分钟空闲回收外，还有最多 6 个 live session 的 LRU 上限。WePChat 的 Claude/Pi 已有空闲回收，但没有跨 Agent 的总量上限；长期打开很多会话时可增加统一配额。

不建议迁移 Kivio 的统一 `RuntimeAgentDef + StreamFormat` 大分发器。WePChat 当前按 Codex app-server、Claude stream-json、Pi RPC 分模块，更贴合三套协议，也更容易保留各自的真实能力。若未来加入多个 ACP Agent，只需为 ACP 新建一套共享驱动，不应反向重写已有三家。

## 2. Grok CLI

本机核验版本：`grok 0.2.112`。可执行文件位于 `~/.grok/bin/grok.exe`。

### 连接方式

Grok 提供 ACP stdio 服务：

```text
grok agent [--model <id>] [--reasoning-effort <level>] [--always-approve] stdio
```

连接使用按行 JSON-RPC：

```text
initialize
  -> session/new 或 session/load
  -> session/set_config_option 或 session/set_model（可选）
  -> session/prompt（每轮）
  -> session/update 通知
  -> session/cancel（停止）
```

`session/update` 至少需要映射正文增量、思考增量、工具开始/更新、可用命令更新和 usage。正文去重游标必须按消息边界处理，不能把整个 turn 的累积文本当作同一条消息。

### Grok 特有处理

- 模型列表优先取 ACP `session/new` 返回的 `availableModels/configOptions`；`grok models` 可作为便宜的认证或诊断入口，但缓存成功不等于真实会话仍已认证。
- reasoning 可能是启动参数，而不是会话内配置。若 ACP 没有对应 `configOptions`，运行中切换 reasoning 应关闭并恢复会话，不能只更新 UI。
- 图片通过 ACP prompt content block 发送：`{type:"image", data:<base64>, mimeType:<mime>}`。
- 不应像 Kivio 一样固定传 `--always-approve`。WePChat 应优先响应 ACP 权限请求；只有用户明确选择完全访问时才自动批准，并同步 Grok 可用的 sandbox/permission 设置。
- 模型探测会创建 `session/new`。应懒加载并缓存，避免反复产生探测会话或启动延迟。

## 3. OpenCode

当前机器未安装 OpenCode，以下基于 Kivio 的 ACP 实现和归档测试；实施前必须选定 OpenCode 版本并重新核验 `--help`、ACP 消息形态和权限请求。

### 连接方式

优先依次解析 `opencode-cli`、`opencode`，然后启动：

```text
opencode acp
```

会话主链与 Grok 共用同一个 ACP 驱动：`initialize -> session/new/load -> session/prompt`。模型切换、取消、工具事件、图片和恢复都走 ACP，不单独解析 TUI 输出。

### OpenCode 特有处理

- 模型真值优先来自当前项目目录下执行的 `opencode models`，解析 `provider/model`。让 OpenCode 自己合并全局配置与项目 `opencode.json/jsonc`，WePChat 不复制其配置解析规则。
- 模型缓存键必须包含规范化后的项目根目录。一个项目的自定义 provider/model 不能泄漏到另一个项目。
- 原生模型命令失败时再尝试 ACP 模型发现；两者都失败后才显示静态 fallback，并在 UI 标明“降级列表”及提供重试。
- Kivio 将 OpenCode 当作通用 ACP Agent，这是合适的最小接入方式；不要为它复制一套 Claude/Pi 风格的专用进程池。

## 4. 建议实施顺序

1. 抽出 WePChat 全局后台命令 helper，并补 Windows PATH 刷新。
2. 将 Agent 可用性和模型发现拆分、缓存，先消除三家现有检测延迟。
3. 新建共享 ACP transport/session actor，先接 Grok：本机已有 CLI，协议与模型/权限场景可直接实测。
4. 安装并锁定 OpenCode 测试版本，在同一 ACP 驱动上增加其启动定义和原生模型发现。
5. 两家稳定后再考虑导入各自 MCP/skills；不要把配置导入与首版聊天连接绑在一起。

## 5. 最小验收清单

- Release 构建下检测、模型刷新、启动会话均不出现终端窗口。
- 未安装、未登录、握手超时、进程退出有不同且可操作的错误提示。
- 新建、连续多轮、停止、空闲回收、应用退出、进程异常退出都不遗留子进程。
- 同一会话切模型真实生效；无法热切的 reasoning 会触发透明重连。
- 工具调用前后正文不重复、不丢失，stderr 持续排空且有长度上限。
- 图片使用 ACP 原生 content block；不支持的附件明确降级为文本说明。
- OpenCode 的项目级自定义模型只出现在对应项目中。
- 探测和模型请求有超时、缓存与 single-flight，不在每轮回复前重新启动 CLI。

## 6. Kivio 参考位置

- `example/kivio/src-tauri/src/proc.rs`：Windows 后台进程 helper。
- `example/kivio/src-tauri/src/path_env.rs`：GUI PATH 补全。
- `example/kivio/src-tauri/src/external_agents/detection.rs`：可用性/模型分层和 OpenCode 原生模型探测。
- `example/kivio/src-tauri/src/external_agents/defs/grok.rs`：Grok 启动差异。
- `example/kivio/src-tauri/src/external_agents/defs/acp.rs`：OpenCode 与通用 ACP 定义。
- `example/kivio/src-tauri/src/external_agents/session/acp.rs`：ACP 握手、持久会话、取消和事件解析。
- `example/kivio/src-tauri/src/external_agents/session/live.rs`、`src-tauri/src/state.rs`：actor、空闲回收和 LRU 上限。
