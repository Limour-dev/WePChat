# 设置页面优化：关闭行为 / 托盘 / 应用内更新 / 布局打磨

时间：2026-07-26 · 规范依据：`docs/design-system.md` · 状态：**计划**（实施后回写记录）

## 背景

设置页是功能堆出来的，缺桌面应用的基本盘：没有关闭行为选项（点关闭就直接退出）、
没有托盘/后台驻留、关于页只有两行文字，无法跳转 GitHub、无法检查与安装更新。
布局上也有几处明显毛病（见「现状问题」）。本次分四个阶段改造，前三个为必做，
第四个为自由打磨。

## 现状盘点

### 结构

- 入口：`ui/index.html` 左列表栏 `#settings-nav`（8 项）+ 中部 `.settings-content` 内
  8 个 `.settings-page`（providers / workspace / agent / external / image / appearance /
  backup / about）。切换逻辑 `app.js:setSettingsPage()`。
- 持久化：`src-tauri/src/settings.rs` 的 `AppSettings` 单 JSON 文件
  （`app_data_dir/settings.json`），前端 `invoke('save_settings')` 整体覆盖保存。
- 关闭路径：自绘标题栏（`decorations:false`），`window-controls.js` 的 `#win-close`
  直接 `win.close()`；后端 `lib.rs on_window_event` 在 `CloseRequested` 时 shutdown
  全部外部 agent + PowerShell 终端 + DB checkpoint。
- 插件现状：仅 `tauri-plugin-opener`。无 tray / dialog / autostart / updater；
  `tauri` crate 未开 `tray-icon` feature。
- 版本：`Cargo.toml` 与 `tauri.conf.json` 均为 `0.1.0`，`get_app_meta` 返回
  `CARGO_PKG_VERSION`，关于页显示 `WePChat v0.1.0 · Windows`。
- 隐藏能力：`AppSettings` 已有 `system_prompt` / `temperature` / `max_tokens` 字段，
  api.js 三种协议都会带上，但**设置页没有任何对应 UI**。

### 现状问题（含 image copy.png 所示）

1. **滚动条不靠右**：`.settings-content` 既是滚动容器又限 `max-width:620px`
   （app.css:1754），滚动条贴在 620px 内容边缘而不是面板右缘。
2. **路径字段贴最左**：`.external-agent-path` 是 `.settings-card` 的兄弟节点被塞在
   卡片列表里（index.html:604），标签「Codex CLI 路径（可选）」顶格，
   与卡片内行的内边距不齐，视觉上像掉出来的。
3. **路径全靠手输**：工作区自定义根目录、三个 agent 的 CLI 路径都是纯文本框，
   没有系统文件/目录选择器。
4. 关于页只有一行版本 + 一句 slogan，没有 GitHub 链接与更新入口。
5. 每页各有一个「保存」按钮，开关类改动（如启用外部连接）也要手动点保存，
   与外观页「点了即生效」的行为不一致。

## 版本与 Release Tag 约定（先定规则）

仓库 `https://github.com/WEP-56/WePChat` 的现有 release 全部是安卓端：
tag `v1.0.0` ~ `v1.0.11`，资产为 `.apk`。桌面端版本号独立演进，约定：

- **安卓端沿用 `vX.Y.Z`**（不动）。
- **Windows 桌面端使用 `win-vX.Y.Z`**；Windows 版尚未正式发布，**首版按
  `win-v0.1.0` 发布**（`Cargo.toml` / `tauri.conf.json` 保持 `0.1.0` 不动，
  今后两处保持一致，`get_app_meta` 以 Cargo 为准）。release 资产为 tauri
  打包产物 `WePChat_X.Y.Z_x64-setup.exe`（nsis，更新流程只认它）与 `.msi`。
- 更新检查**只按 tag 前缀 `win-v` 过滤**，再校验资产里存在 `-setup.exe`，
  双保险避免误抓安卓包。

## 改动计划

### 阶段 A：布局修缮（纯前端，先做，风险最低）

1. **滚动条归位**：`.settings-content` 去掉 `max-width`，滚动条落在面板右缘；
   内容宽度约束下移到 `.settings-page { max-width: 620px; }`。
2. **外部连接卡片重排**：每个 agent 改为独立分组——卡片内头行（品牌图标 + 名称 +
   状态副标 | 检测按钮 + 开关）下接同卡的路径行，路径 label 与行文本共用卡片内边距；
   删除游离的 `.external-agent-path` 顶格样式。三个 agent 之间用卡片间距分隔，
   替代现在一张大卡里行与字段交错的结构。
3. **路径输入组件化 `.path-field`**：`输入框 + 「浏览…」按钮` 组合，新增
   `tauri-plugin-dialog`：
   - 工作区自定义根目录 → 目录选择器；
   - Codex / Claude / Pi CLI 路径 → 文件选择器（过滤 `*.exe;*.cmd;*.bat;*.ps1`，
     允许全部文件，因为 npm shim 可能无扩展名）；
   - 只读路径（当前生效根目录 / 当前会话工作区）行尾加「在资源管理器中打开」
     图标按钮（走已有 `opener` / `ws_reveal_path` 能力）。
4. 顺手统一：数字输入（工具轮次/调用数）宽度收窄右对齐；各页 `field-status`
   提示样式统一。

涉及：`ui/index.html`、`ui/css/app.css`、`ui/css/external-agent-mode.css`、
`ui/js/app.js`（浏览按钮绑定）、`ui/js/external-agent-mode.js`、
`src-tauri`（dialog 插件注册 + capability `dialog:default`）。

### 阶段 B：常规页 —— 关闭行为 / 托盘 / 后台运行 / 开机自启

新增设置子页「常规」，置于导航第一位。

**settings.rs 新增字段**（camelCase 序列化，均带 serde default 兼容旧文件）：

```rust
/// 关闭主窗口时的行为："ask"(默认，首次询问) | "exit" | "minimize" | "tray"
pub close_behavior: String,
/// 常驻系统托盘图标（选 tray 关闭行为时 UI 强制开启并置灰）
pub tray_enabled: bool,
/// 开机自启
pub auto_start: bool,
/// 自启后不弹主窗口，直接进托盘（依赖 tray_enabled）
pub start_minimized: bool,
```

**UI（常规页）**：

- 「关闭主窗口时」三段选择：最小化 / 隐藏到托盘 / 退出（`.seg` 组件）。
  存量值 `ask` 表示未选过：用户第一次点关闭按钮时弹 UIDialog
  「隐藏到托盘继续运行 / 直接退出 + 记住我的选择」，写回 close_behavior。
- 「常驻系统托盘」开关；「开机自启」开关；「启动时最小化到托盘」开关
  （依赖前两者，未满足时置灰）。
- 本页所有控件**即改即存**（与外观页一致），不设保存按钮。

**后端**：

- `Cargo.toml`：`tauri = { version = "2", features = ["tray-icon", "image-png"] }`；
  新增 `tauri-plugin-autostart`、`tauri-plugin-single-instance`。
- 新模块 `src-tauri/src/tray.rs`：按设置创建/销毁托盘图标（复用 `icons/icon.ico`）。
  - 左键单击 → 显示并聚焦主窗口；
  - 右键菜单：`显示 WePChat` / `新建聊天`（显示窗口并 emit 事件给前端）/
    分隔线 / `退出`。
- **关闭拦截重构（关键）**：`lib.rs on_window_event` 的 `CloseRequested` 分支改为：
  1. 读取 close_behavior；`minimize` → `api.prevent_close()` + 最小化；
     `tray` → `api.prevent_close()` + `window.hide()`（若托盘图标未建则临时创建）；
     `ask` → `api.prevent_close()` + emit `app://close-requested` 让前端弹选择框；
     `exit` → 放行。
  2. 现有清理（shutdown 三个 agent、PowerShell 终端、DB checkpoint）**移出**
     `CloseRequested`，改挂到 `Builder::build().run(|app, event|)` 的
     `RunEvent::Exit`，保证托盘驻留期间外部 agent 会话继续存活，真正退出
     （托盘菜单「退出」或 close_behavior=exit）时才清理；清理逻辑幂等，
     多路径触发也安全。同步更新 `docs/external-agent-integration.md` §2 中
     「窗口关闭时调用 shutdown」的措辞为「应用真正退出时」。

  **2026-07-26 复核（Pi 落地后）**：结论不变，且与托盘驻留天然兼容——
  claude / pi 都是一会话一进程 + 10 分钟空闲回收，托盘后台闲置时子进程会被
  正常回收，恢复窗口再发任务经 `--resume` / `--session` 透明续接，不会长期
  挂进程；codex 是共享连接、无空闲回收，驻留期间保持存活，用户可用新加的
  顶栏「刷新连接 / 终止连接」抽屉手动控制。`PiAgent::shutdown_all()` 已加入
  关闭清理列表，挪动时三个 agent + PowerShell 终端一起挪。
- `tauri-plugin-single-instance`：二次启动时显示并聚焦已有实例
  （托盘隐藏状态下重复点快捷方式不再报错/多开）。
- capability 增加：`dialog:default`（阶段 A）、`autostart:default`；
  托盘与菜单为 Rust 侧构建，不需要新窗口权限。

### 阶段 C：关于页 + 应用内更新

**关于页重做**（`data-settings-page="about"`）：

- 头部卡片：应用图标 + `WePChat` + `v0.1.0 · Windows 桌面版` +
  副标（安卓端为独立版本线，见 tag 约定）。
- 操作行：`GitHub 仓库`（opener 打开 `https://github.com/WEP-56/WePChat`）、
  `反馈问题`（打开 `/issues/new`）、`检查更新` 主按钮。
- 更新卡片（默认隐藏，状态机驱动）：
  `检查中 → 已是最新 / 发现新版本 → 下载中(进度) → 待安装 → 安装中` + `失败(重试)`。
  发现新版本时展示：新版本号、release 标题、正文（复用 markdown.js 渲染，
  DOMPurify 消毒）、安装包体积。

**更新后端**（新模块 `src-tauri/src/updater.rs`，自实现，不用
tauri-plugin-updater——官方插件要求独立签名清单，与「按 GitHub release tag」
的诉求不匹配）：

- `update_check`：GET `https://api.github.com/repos/WEP-56/WePChat/releases?per_page=30`
  （带 `User-Agent`，复用 reqwest）；过滤 `tag_name.starts_with("win-v")` 且资产含
  `-setup.exe`；语义化比较最高版本与 `CARGO_PKG_VERSION`。返回
  `{ hasUpdate, tag, version, name, body, publishedAt, asset: { name, size, url, sha256 } }`
  （GitHub 资产 API 现在带 `digest` 字段，直接取用）。
- `update_download`：流式下载 `browser_download_url` 到
  `app_data_dir/updates/<file>.partial`，每 ≥256KB emit
  `update://progress { received, total }`；完成后 sha256 校验（digest 存在时），
  改名去掉 `.partial`。支持 `update_download_abort`（复用 AbortRegistry 模式）。
- `update_install`：`std::process::Command` 启动 setup.exe（NSIS currentUser，
  交互式安装，不用 `/S`，避免静默失败无感知），随后 `app.exit(0)` 走正常清理。
- 失败兜底：任一步骤失败，更新卡片给出「去 GitHub 手动下载」链接。
- 网络注意：GitHub API 匿名限流 60 次/小时，检查失败（含 403）按「检查失败，
  稍后再试」处理；不做自动周期检查，仅启动后台默检一次（静默，仅在关于页
  导航项上挂小红点）+ 手动触发。

### 阶段 D：自由打磨（可裁剪）

1. **新增「对话」设置页**：把已有但无 UI 的三个字段补上——默认系统提示词
   （textarea）、温度（0–2，空 = 跟随供应商）、最大输出 tokens（空 = 默认）。
   放在「模型与供应商」之后。
2. **导航重排**：常规 / 模型与供应商 / 对话 / 工具与代理 / 外部连接 / 生图 /
   对话文件目录 / 外观 / 备份 / 关于。
3. **保存体验统一**：新增页（常规/对话/关于）全部即改即存；存量页维持显式保存
   不动（避免连锁改动），仅统一状态提示文案（保存中… / 已保存 / 保存失败）。
4. 关于页下方补「开源组件」折叠列表（marked / DOMPurify / highlight.js / KaTeX /
   xterm.js 等）——纯静态，顺手提升完成度。

### 不做什么

- 不做静默自动更新、不做增量/差量更新、不做 MSI 更新链路（只认 nsis setup.exe）。
- 不动供应商 / 工具权限 / 生图 / 外观页的既有交互逻辑。
- 不做多语言；不做备份页功能（另立项）。
- 不引入 tauri-plugin-updater 与签名基础设施。

## 实施顺序与验证

顺序：A → B → C → D（每阶段独立可交付，B 的关闭拦截重构需要重点回归）。

验证（UI 部分由用户自测）：

- A：设置各页滚动条贴面板右缘；外部连接页路径字段与卡片对齐；浏览按钮能唤起
  系统选择器且回填路径；三主题 × 深浅色过一遍版式。
- B：三种关闭行为逐一验证；托盘隐藏期间外部 agent 会话不断线（Codex/Claude/Pi
  任务进行中隐藏窗口再唤回）；托盘「退出」后进程与 PowerShell 子进程全部退出；
  开机自启注册表项生效；二次启动聚焦既有窗口。
- C：模拟三种情况——无 `win-v` tag（提示已是最新）、有新版本（完整走
  检查→下载→进度→安装拉起 NSIS）、断网/限流（失败提示 + 手动下载链接）。
  校验不会把安卓 `vX.Y.Z` release 识别为桌面更新。
- 构建：`cargo check` + 打包一次 nsis 验证资产命名与更新流程闭环。

## 实施记录

（实施后回写）
