# WePChat 架构说明

本文档为后续 AI agent / 开发者快速分析仓库提供地图。WePChat 是一个**本地优先**的 LLM 客户端，当前仓库是一个单体产品：**手机端 H5/HTML5+ App（根目录）**。

> 一句话：**手机端 H5/HTML5+ App（根目录）**。
---

## 1. 顶层结构

```
WePChat/
├── index.html             # 手机端(SWD)入口 —— 单页 Vue3 应用，全部靠 <script> 顺序加载
├── manifest.json          # HBuilderX / HTML5+ 配置（Android 打包、权限、App 元信息）
├── androidPrivacy.json    # Android 隐私合规配置
├── server.py              # 本地静态服务器（带 CORS 头，用于远程配置拉取等跨域场景）
├── wepchat.config.json.template  # 远程默认配置模板（JSONC，含全部配置项注释；实际使用复制为 wepchat.config.json，已 gitignore）
├── css/                   # 手机端样式（app.css 主样式 + liquid-glass + onboarding）
├── js/                    # 手机端全部逻辑（~10k 行，普通旧式脚本，非 ESM）
│   ├── app.js             # 入口：await Store.init() → 装配 methods → Vue.createApp().mount()
│   ├── logger.js          # 统一控制台埋点日志（WLog），自动脱敏、截断、分级
│   ├── app-options.js     # Vue 根选项（data/computed/watch 等）
├── libs/                  # 第三方库（vue 全局版、marked、purify、highlight、liquid-glass）
├── img/                   # 图标与截图
└── docs/                  # 手机端设计/拆分/备份等文档

---

## 2. 产品运行形态与数据流

### 2.1 手机端（根目录，H5 / HBuilderX Android App）
核心运行方式是 **H5 + HTML5+**。同样的 `index.html` 可在浏览器打开（降级为普通 H5），也可用 HBuilderX 按 `manifest.json` 打包成 Android App（获得 `plus.*` 原生能力：文件、相册、分享、Zip、通知、扫码、后台运行等）。
---

## 3. 手机端（根目录）模块详解

### 3.1 加载顺序（`index.html`）—— 关键约束
所有脚本是**普通旧式 `<script>` 顺序加载**，依赖全局命名空间挂载，不是 ES module。顺序即依赖顺序：

1. **第三方库**：`vue.global.prod.js`、`marked`、`purify`、`highlight`、`liquid-glass-vue`
2. **日志层**：`logger.js`（WLog，所有模块通过它输出控制台日志）
3. **基础层**：`util.js` → `store.js` → `markdown.js` → `model-metadata.js` → `network-stability.js`
4. **API 层**：`api.js` → `image-api.js`
5. **Agent 工具**：`tools/registry.js` → `tools/workspace.js` → 各工具文件 → `tools.js`（门面，暴露 `window.Tools`）
6. **应用层**：`app-helpers.js` → `theme-system.js` → `app-options.js` → `app-methods-*.js` → `app.js`

> 新增脚本必须插在正确位置；`tools.js` 门面依赖 `WepChatTools` 已完整加载，`app.js` 依赖所有 `app-methods-*` 已挂到 `window`。

### 3.2 启动流程（`js/app.js`）
```js
await Store.init();                      // 打开 IndexedDB、预热缓存、迁移 localStorage
options.methods = Object.assign({}, 
  ...所有 window.WepChatAppMethods* 域);  // Vue methods 合并
const app = Vue.createApp(options);
// 注册 Liquid Glass（毛玻璃渲染）组件与滤镜
app.mount('#app');
```
Vue 根选项定义在 `app-options.js`；`methods` 通过解构 `window.WepChatAppHelpers` 里的工具函数来复用纯函数。

### 3.3 功能域（`js/app-methods-*.js`）
| 文件 | 职责 |
|---|---|
| `app-methods-core.js` | 应用设置、plus 初始化、返回键、版本/更新检查、远程默认配置拉取与应用 |
| `app-methods-sessions.js` | 会话管理 |
| `app-methods-workspace.js` | 工作区：文件树、新建/上传/编辑/删除/导出、HTML 预览 |
| `app-methods-generation.js` | 文本/图片生成流程（多轮工具调用、流式正文累计、思考/工具卡片） |
| `app-helpers.js` | 共享纯函数：`smoothText` 逐字动画（按积压比例揭示）、`syncReasoning`/`finalizeReasoning` 思考卡片、`syncStreamToolCalls`/`finalizeStreamToolCalls` 工具卡片、variant 快照等 |
| `app-methods-theme.js` | 主题 |
| `app-methods-onboarding.js` | 首次引导 |
| `app-methods-lock.js` | 应用锁 |
| `app-methods-stability.js` | 稳定性/重试 |
| `app-methods-image-recovery.js` | 图片结果恢复（只取结果不重新扣费） |

### 3.4 存储层（`js/store.js`）
- **IndexedDB + 内存缓存**，按会话分键（`wc.sessions` 索引 + `wc.session.<id>`）。
- 原因：Android WebView 的 `localStorage` 仅约 5MB，base64 图片易触发 `QuotaExceededError`；IndexedDB 配额按磁盘算。
- `Store.init()` 有 3s 超时降级回 `localStorage`（个别 ROM 上 IndexedDB open 可能不回调）。
- 旧 `localStorage` 数据自动迁移。

### 3.5 模型 API 层（`js/api.js`）
适配四种接口形态，统一输出增量回调：
- `openai-chat`（Chat Completions，含工具调用）
- `openai-responses`（Responses，含工具调用）
- `anthropic`（Messages，含工具调用）
- `openai-completions`（传统补全，无工具）

统一增量输出 `onUpdate({ content, reasoning, streamTools, usage })`：
- `content`：当前 step 的**完整**正文（非增量，由调用方用 `lastSeenLen` 追增量累计）
- `reasoning`：当前 step 的**完整**思考内容（thinking / reasoning delta）
- `streamTools`：流式工具调用（参数增量中，`input_json_delta`）
- API 层只做事件解析与累计，**不碰 UI**；渲染/动画完全由应用层（§3.9）负责

> 注意：推理模型（如 deepseek-v4-flash）可能**大部分 SSE 事件都是 thinking delta，正文 content 为空**——
> 这会导致纯文本区域长时间无更新，需要思考卡片（§3.9）来呈现实时进度。
### 3.6 Agent 工具（`js/tools/`）
- `registry.js`：注册表 + 公共限制（`MAX_FILE` 512KB、`MAX_FILES` 50、`MAX_SERVICES` 5、`JS_TIMEOUT` 8s、`WEB_FETCH_TIMEOUT` 20s 等）。
- `workspace.js`：路径安全校验、工作区共享能力。
- 每个工具一个文件：`run-js.js`（隔离沙盒）、`read-file/write-file/edit-file/delete-file/list-files/create-folder/move-path/path-exists`、`preview-file`、`web-fetch`、`image-go`、`create-workspace`、`run-service/stop-service/list-services`、`system-hint`。
- `tools.js` 是兼容门面，把 `WepChatTools` 暴露成 `window.Tools`（`DEFS/SYSTEM_HINT/execute/runJS/...`）。
- **边界**：内置工具是受控轻量工具集，不提供真实 shell / 包管理器 / Python / 完整 Linux。
- **默认只开 `run_js`**：`app-methods-generation.js` 的 `enabledTools()` 按 `toolPermission(d.name) !== 'never'` 过滤 `Tools.DEFS`；默认 `toolPermissions` 仅 `run_js: 'ask'`，其余 (`files`/`delete_files`/`services`/`web_fetch`) 均为 `never`，`image_go` 则受默认 `imagePermission: 'never'` 门控。用户可在设置里把对应工具改为 `ask`/`always` 以启用。
- **系统提示词**：仅发送设置里显式填写的 `systemPrompt`；不自动附加内置 `Tools.SYSTEM_HINT`。

### 3.7 远程默认配置（`server.py` + `wepchat.config.json.template`）
用于从服务器拉取 JSON 配置作为应用默认设置，方便团队/多设备统一配置。
- `wepchat.config.json.template`：带注释（JSONC）的配置模板，含全部配置项；实际使用复制为 `wepchat.config.json`（已加入 `.gitignore`）放到服务器。
- 应用侧逻辑在 `app-methods-core.js`：`fetchRemoteConfig()` 用 XHR GET 拉取 URL，`stripJsonComments()` 剥离 `//` 与 `/* */` 注释后再 `JSON.parse`；`applyRemoteConfigAsDefaults()` 与现有设置合并（含 providers 去重/规范化）后持久化。
- `server.py`：本地静态服务器，为所有响应加 CORS 头并处理 `OPTIONS` 预检，解决 WebView / 浏览器拉取远程配置时的跨域拦截（默认端口 8765）。

### 3.8 控制台埋点日志（`js/logger.js`）
统一日志模块 `WLog`，所有核心模块通过它输出结构化控制台日志，方便排查问题。
- **分级**：`debug / info / warn / error`，可通过 `WLog.level = 'warn'` 调整 verbosity。
- **格式**：`[WepChat][HH:MM:SS.mmm][Tag] message`，带毫秒级时间戳和模块标签。
- **自动脱敏**：JSON 序列化时 `apiKey / api_key / secret / password / hash / salt / authorization` 字段替换为 `***REDACTED***`，防止敏感信息泄露到控制台。
- **超长截断**：>300 字符的字符串自动截断，避免 base64 图片数据刷屏。
- **计时辅助**：`const end = WLog.time('API'); ... end('done')` 输出耗时。
- **覆盖模块**：`api.js`（SSE/HTTP）、`store.js`（IndexedDB/localStorage）、`network-stability.js`（重试）、`app-methods-generation.js`（生成流程/工具调用）、`image-api.js`（图片生成降级）、`tools/registry.js`（工具执行）、`util.js`（文件操作）、`app-methods-sessions.js`（会话切换）。
- **流式诊断标签**：`[SSE]`（api.js 每 100 事件）、`[Stream]`（onUpdate 每 50 事件或 1s）、`[Smooth]`（smoothText 动画 start/commit/done）、`[Render]`（renderMd 流式渲染每 500ms）。用于定位"流式期间 UI 不更新"类问题：分别确认事件到达、内容累计、消息对象写入、Vue 重渲染四层。
- **加载顺序**：在 `index.html` 中位于第三方库之后、所有业务脚本之前，确保全局可用。

### 3.9 流式渲染管线（思考卡片 + smoothText 动画）
聊天生成的流式数据从 SSE 到 DOM 分四层，任何一层卡住都会表现为"SSE 期间 UI 不更新、结束后才慢慢滚动"：

1. **API 层（`api.js`）**：`sseRequest` 用 XHR `onprogress` 增量解析 `data:` 行，按事件类型累计到 `st` 并回调 `onUpdate`。
2. **生成层（`app-methods-generation.js` `generateAssistant`）**：
   - `accumulatedContent` / `accumulatedReasoning` 跨 step 累计（`lastSeenLen` 追增量，避免多轮工具调用覆盖正文）；
   - `currentStepReasoning` 按 step 独立追踪，供思考卡片使用；
   - 每事件调用 `smoothText()`（正文动画）与 `syncReasoning()`（思考卡片实时更新）+ `syncStreamToolCalls()`（工具卡参数增量）。
3. **动画层（`app-helpers.js` `smoothText`）**：`setInterval(24ms)` 按**积压比例**揭示正文：
   - `step = max(1, min(60, ceil(rest/10)))`：积压越大揭示越快，流式速率高时保持 ~20-35 字符小积压，结束后 ~0.5s 排空；
   - 旧实现按固定档位（1-12 字符/24ms）揭示，流式快时积压越来越大，表现为"结束后才慢慢滚动"。
4. **渲染层（Vue 模板 `index.html`）**：每条 assistant 消息包含：
   - **思考卡片**（`m.reasonings`，每 step 一张，`displayReasonings(m)` 渲染）：默认展开、紫色左边框、状态"思考中（spinner）/ 完成"，文字随 SSE 实时增长；
   - **工具调用卡片**（`m.toolCalls`，`displayToolCalls(m)` 渲染）：composing/running/done 状态；
   - **正文**（`m.content`，`renderMd(m)` 渲染）：`v-html` markdown，由 smoothText 逐字揭示。

> 推理模型（如 deepseek-v4-flash）常把大部分 SSE 事件用于 thinking delta，正文 content 为空；
> 若没有思考卡片，用户会看到"思考中…"长时间无变化，误以为卡死。

## 4. 手机端文档（`docs/`）
- `app-js-split-plan.md` / `tools-js-split-plan.md`：历史重构（拆分 app.js / tools.js）的设计与实施记录。
- `stability-recovery-plan.md`：网络稳定性、重连、错误码、图片结果恢复方案。
- `backup-format.md`：`.wepchat` ZIP 容器备份格式。
- `tools.md`：Agent 工具说明 + 系统提示词快照。

---

## 5. 关键设计理念
- **克制轻量**：不内置完整 Linux、常规聊天不提供真实 shell、不承诺长期后台执行、不做重型图片工作站/完整浏览器/繁琐配置。
- **本地优先**：索引/图片用 IndexedDB 而非 localStorage。
- **能力边界**：手机内置工具受控（无真实 shell）。
- **稳定性**：可见错误码、五次重连、WebSocket 心跳、事件补播、断线续接、图片结果恢复（不重复扣费）。

---

## 6. 常用开发 / 检查命令

```bash
# 手机端语法检查（node 可解析旧式脚本）
node --check js/app.js && node --check js/api.js && node --check js/image-api.js \
  && node --check js/tools.js && node --check js/store.js && node --check js/util.js \
  && node --check js/model-metadata.js

# 本地静态预览手机端（推荐自带 CORS 的 server.py，支持远程配置拉取）
python3 server.py 8765   # 打开 http://127.0.0.1:8765/

# 远程默认配置模板（复制去掉 .template 后缀，已 gitignore）
cp wepchat.config.json.template wepchat.config.json

`git diff --check` 用于提交前空白检查。手机端 `node --check` 只校验语法可解析，不执行（浏览器 API 在 Node 下不存在）。

---

## 7. 给后续 agent 的提示
1. 手机端是**普通 `<script>` 全局脚本**，新增文件要按 §3.1 顺序插入 `index.html`，并挂到正确的 `window` 命名空间。
2. 新增脚本必须插在正确位置；`tools.js` 门面依赖 `WepChatTools` 已完整加载，`app.js` 依赖所有 `app-methods-*` 已挂到 `window`。
3. 新增关键路径代码应使用 `WLog`（§3.8）添加埋点日志，避免直接使用 `console.log`；涉及敏感对象的日志由 WLog 自动脱敏。
4. 流式渲染链路（§3.9）四层：`api.js` SSE 解析 → `generateAssistant` 累计 → `smoothText` 动画 → Vue 模板。排查"流式期间 UI 不更新"时按 `[SSE]/[Stream]/[Smooth]/[Render]` 四类日志逐层定位。
5. 修改 `smoothText` 的揭示步进时注意：固定小步进在快速流式下会积压，导致"结束后才慢慢滚动"；应按积压比例（`rest/10`）步进。
6. 思考内容用 `m.reasonings`（每 step 一张卡片），不要只存 `m.reasoning` 单个字符串——推理模型可能大部分 SSE 事件都是 thinking，没有卡片用户会误以为卡死。
7. **Vue3 响应式陷阱（raw vs Proxy）**：本项目实际使用 Vue 3.4（`libs/vue.global.prod.js`，Proxy 响应式），不是 Vue2。往 `session.messages` push 新消息时，局部变量持有的是 **raw 对象**，而模板渲染拿到的是 **Proxy**；流式期间直接改 raw 对象（`syncReasoning`、`msg.reasoning = ...`、`msg.status = ...`）**不会触发重渲染**，表现为“SSE 正常到达但思考卡片/正文不更新，结束后才一次性出现”。正确写法是 push 后从响应式数组读回 Proxy 再修改：`assistantMsg = this.session.messages[this.session.messages.length - 1]`（见 `sendImageMessage` 与 `generateAssistant` 新消息分支）。重新生成分支（`this.session.messages[targetIndex]`）天然是 Proxy，无需处理。