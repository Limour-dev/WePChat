# WePChat 架构说明

本文档为后续 AI agent / 开发者快速分析仓库提供地图。WePChat 是一个**本地优先**的 LLM 客户端，当前仓库是一个单体产品：**手机端 H5/HTML5+ App（根目录）**。

> 一句话：**手机端 H5/HTML5+ App（根目录）**。
---

## 1. 顶层结构

```
WePChat/
├── index.html             # 手机端(SWD)入口 —— 单页 Vue2 应用，全部靠 <script> 顺序加载
├── manifest.json          # HBuilderX / HTML5+ 配置（Android 打包、权限、App 元信息）
├── androidPrivacy.json    # Android 隐私合规配置
├── css/                   # 手机端样式（app.css 主样式 + liquid-glass + onboarding）
├── js/                    # 手机端全部逻辑（~10k 行，普通旧式脚本，非 ESM）
│   ├── app.js             # 入口：await Store.init() → 装配 methods → Vue.createApp().mount()
│   ├── app-options.js     # Vue 根选项（data/computed/watch 等）
│   ├── app-methods-*.js   # Vue methods 按功能域拆分（见 §3.3）
│   ├── app-helpers.js     # 手机端共享工具函数（纯函数，多被 methods 解构使用）
│   ├── api.js / image-api.js   # 模型 Provider 适配层 / 图片生成与编辑
│   ├── store.js           # 本地存储层（IndexedDB + 内存缓存，旧 localStorage 迁移）
│   ├── util.js            # 通用工具
│   ├── markdown.js        # Markdown / 代码高亮渲染
│   ├── model-metadata.js  # 模型能力元数据（上下文/输出/视觉/工具/图像等）
│   ├── network-stability.js  # 重连/错误码/事件补播
│   ├── theme-system.js    # 主题
│   ├── tools.js           # Agent 工具「兼容门面」，转发到 WepChatTools
│   └── tools/             # Agent 工具独立模块（registry + 每个工具一个文件）
├── libs/                  # 第三方库（vue 全局版、marked、purify、highlight、liquid-glass）
├── img/                   # 图标与截图
└── docs/                  # 手机端设计/拆分/备份等文档
```

---

## 2. 产品运行形态与数据流

### 2.1 手机端（根目录，H5 / HBuilderX Android App）
核心运行方式是 **H5 + HTML5+**。同样的 `index.html` 可在浏览器打开（降级为普通 H5），也可用 HBuilderX 按 `manifest.json` 打包成 Android App（获得 `plus.*` 原生能力：文件、相册、分享、Zip、通知、扫码、后台运行等）。
---

## 3. 手机端（根目录）模块详解

### 3.1 加载顺序（`index.html`）—— 关键约束
所有脚本是**普通旧式 `<script>` 顺序加载**，依赖全局命名空间挂载，不是 ES module。顺序即依赖顺序：

1. **第三方库**：`vue.global.prod.js`、`marked`、`purify`、`highlight`、`liquid-glass-vue`
2. **基础层**：`util.js` → `store.js` → `markdown.js` → `model-metadata.js` → `network-stability.js`
3. **API 层**：`api.js` → `image-api.js`
4. **Agent 工具**：`tools/registry.js` → `tools/workspace.js` → 各工具文件 → `tools.js`（门面，暴露 `window.Tools`）
5. **应用层**：`app-helpers.js` → `theme-system.js` → `app-options.js` → `app-methods-*.js` → `app.js`

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
| `app-methods-core.js` | 应用设置、plus 初始化、返回键、版本/更新检查 |
| `app-methods-sessions.js` | 会话管理 |
| `app-methods-workspace.js` | 工作区：文件树、新建/上传/编辑/删除/导出、HTML 预览 |
| `app-methods-generation.js` | 文本/图片生成流程 |
| `app-methods-preview.js` | 多页面 HTML 预览（地址栏、前进/后退、刷新） |
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

### 3.6 Agent 工具（`js/tools/`）
- `registry.js`：注册表 + 公共限制（`MAX_FILE` 512KB、`MAX_FILES` 50、`MAX_SERVICES` 5、`JS_TIMEOUT` 8s、`WEB_FETCH_TIMEOUT` 20s 等）。
- `workspace.js`：路径安全校验、工作区共享能力。
- 每个工具一个文件：`run-js.js`（隔离沙盒）、`read-file/write-file/edit-file/delete-file/list-files/create-folder/move-path/path-exists`、`preview-file`、`web-fetch`、`image-go`、`create-workspace`、`run-service/stop-service/list-services`、`system-hint`。
- `tools.js` 是兼容门面，把 `WepChatTools` 暴露成 `window.Tools`（`DEFS/SYSTEM_HINT/execute/runJS/...`）。
- **边界**：内置工具是受控轻量工具集，不提供真实 shell / 包管理器 / Python / 完整 Linux。
---

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

# 本地静态预览手机端
python -m http.server 8765   # 打开 http://127.0.0.1:8765/
```

`git diff --check` 用于提交前空白检查。手机端 `node --check` 只校验语法可解析，不执行（浏览器 API 在 Node 下不存在）。

---

## 7. 给后续 agent 的提示
1. 手机端是**普通 `<script>` 全局脚本**，新增文件要按 §3.1 顺序插入 `index.html`，并挂到正确的 `window` 命名空间。
2. 新增脚本必须插在正确位置；`tools.js` 门面依赖 `WepChatTools` 已完整加载，`app.js` 依赖所有 `app-methods-*` 已挂到 `window`。