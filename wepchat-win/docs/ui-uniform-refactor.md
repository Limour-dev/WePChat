# 生图 / External Agent 界面统一重构

时间：2026-07-25 · 规范依据：`docs/design-system.md`

## 背景

常规聊天模式的界面已定型（密度、留白、组件语言），但生图模式与 External Agent 模式
是功能优先做出来的：组件被重写成劣化版、分割线过多、字号与圆角碎片化、个别地方用 emoji
当图标，整体像塞进来的两个别的项目。本次按设计规范把两个模式重做一遍，不改任何功能逻辑与
数据结构，只动渲染层（HTML 结构 / CSS / JS 里拼 DOM 的部分）。

## 改动计划

### A. 生图模式

1. **布局归位**：把模型选择头从左侧聊天子面板提升为整个 main 列顶部的标准 `.main-top`
   （1fr auto 1fr、居中 model-switch、无底线），下方才是「对话面板 | 画布」分栏；
   删除面板 header 底线与分栏竖线，画布区靠点阵底纹自然分界。
2. **消息复用**：时间线改用 `.chat-message` 体系（用户气泡 / 助手全宽），缩略图复用
   `.chat-image-grid/.chat-image-card`（窄面板补一个宽度修饰类）；删除 `.img-msg-*` 私有气泡。
3. **输入复用**：composer 外壳换成共享 `.composer-box`（22px 圆角 + composer-shadow），
   尺寸胶囊保留；「参考生成 / 编辑图片」换成共享 `.seg` 分段控件。
4. **列表统一**：生图会话列表项与聊天列表同构（单行标题），删除死掉的
   `.image-list-title-row` 区块。
5. **画布工具条**：✋/↖/−/＋/文字按钮全部换 SVG 图标（保留浮动胶囊形态），
   编辑弹层发送钮 `↑` 换 SVG 箭头。
6. **模型/尺寸下拉**：套 model-picker 弹层度量（外壳 r10/p6/大投影、选项两行 13+11px）。

### B. External Agent 模式

1. **external-agent-mode.css 全量重写**：删除双重定义与 mock 残留
   （`.external-main-top`×2、`.external-runtime-state`×2、`.external-mode-segment`、
   `.external-compact-select`、旧终端输出样式、`.external-list-foot` 等），
   字号收敛到 ≥11px，圆角收敛到 7/8/10/12/999。
2. **左栏**：搜索框回归共享胶囊样式；项目/会话树行度量对齐 `.session-item-btn`
   （高 34–36、r8、13px/12px）；删除「界面预览 · 按需启动连接」footer。
3. **顶栏**：对齐 `.main-top` 度量（52px、12px 18px、无底线）；状态点样式保留但字号 11px。
4. **消息区**：内容列 760→720；改用 `.chat-message` 体系；去掉助手头像与常驻时间戳；
   工具步骤卡、审批卡、变更摘要卡对齐 `.tool-card` 语言（r10–12、bg2、soft 分隔），
   状态字符（✓/…/!）换 SVG/spinner。
5. **composer**：外壳复用 `.composer-box`；权限/模型选择器改为安静胶囊按钮；
   发送钮接入 `.is-ready` 状态（与聊天一致）；图片附件条对齐 `.attachment-chip` 度量。
6. **弹层**：权限/模型/打开方式菜单套 model-picker 度量；「打开方式」的 ◆/📁 换 SVG。
7. **右栏工作区**：文件树 / 审阅 / diff 字号提到 11–12.5px，多余边框减档为
   `--border-soft` 或删除；空态复用 `.rp-empty`。

### C. 共享层顺手修正

1. `app.js` 置顶会话的 `📌 ` 前缀换成 SVG pin 图标（`.session-pin`）。
2. `index.html` 生图/External 相关结构按上述调整（id 全部保留，不动绑定）。

### 不做什么

- 不改任何 invoke / RPC / 数据持久化逻辑；
- 不改三栏骨架与拖拽/折叠机制；
- 不动常规聊天与设置页（除 pin 图标）。

## 验证

- 静态自查：三主题 × 深浅色过版式；grep 确认无 emoji、无 <10.5px 字号、无 4/5/6px 圆角。
- Chrome 加载 `ui/index.html` 走一遍生图空态、external mock 数据渲染（Pi/Claude 仍是 mock，
  可离线看版式；Codex 需真连接，由用户在应用内自测）。

## 实施记录

2026-07-25 完成，按计划落地，另含三轮自测反馈修正。

### 文件与改动

- `docs/design-system.md`（新增）：设计规范全文；随反馈补充了「分栏工作台骨架」与
  「右栏标签页模型（含终端进程生命周期）」两条规则。
- `ui/index.html`：
  - 生图：composer 换 `.composer/.composer-box`，参考模式换 `.seg`，模型选择换共享
    `model-picker` 结构；删除死块 `.image-list-title-row` 与列表空态文案微调。
    模型选择头最终**留在对话子面板顶部**（首版提到整宽 main-top，自测后修正）。
  - external：左栏删除「界面预览」footer 与「本地工作区」副题，搜索框回归共享胶囊；
    composer 换 `.composer/.composer-box`；rp-tabbar 内新增 external 专用
    `#external-tab-add-wrap`（+ 菜单），与聊天的添加菜单互不干扰。
- `ui/css/app.css`：生图区段重写——删除 `.image-model-picker-*`/`.image-picker-*`/
  `.img-msg-*`/`.image-workbench`/`.image-empty` 等私有克隆；时间线复用 `.chat-message`
  与 `.chat-image-card`（150px 窄版）；画布底改 `--bg2` 代替分栏竖线；对齐参考线换
  `--warning` token；`#image-model-select` 隐藏（修复原生 select 露出）；
  `.session-item-btn` 改 flex 以容纳 `.session-pin` 图标。
- `ui/css/external-agent-mode.css`：全量重写（1370→约 900 行）。清除双重定义
  （`.external-main-top`、`.external-runtime-state`）与 mock 残留（旧终端输出、
  `.external-mode-segment`、`.external-compact-select`、list footer 等）；字号收敛
  ≥11px、圆角收敛 7/8/10/12/999；弹层对齐 model-picker 度量；顶栏对齐 main-top
  （52px、无底线）；工作区标签**不再固定 180px 宽**，完全继承 `.rp-tab`。
- `ui/js/image-mode.js`：时间线/会话列表/模型下拉改为发射共享类；seg 用 `is-on`；
  发送钮接入 `.is-ready`；删除未用的 `imageCountOfSession`。
- `ui/js/image-canvas.js`：工具条 ✋/↖/−/＋/↑ 全部换 SVG（Material 路径）。
- `ui/js/external-agent-mode.js`：
  - 消息区改用 `.chat-inner` + `.chat-message` 体系，去掉头像与常驻时间戳，
    助手 pending 用 typing-dot；工具步骤状态字符换 SVG/spinner。
  - 右栏改为与聊天一致的标签页模型：`workspaceTabs` 状态 + 可关闭 `.rp-tab` +
    「+」菜单 + 无标签时的 `.rp-tools` 入口页；进入 agent 模式不再默认启动终端。
  - 关闭「终端」标签 → `disposeXterm` + 清空缓冲 + `powershell_terminal_close`，
    解决 PowerShell 隐式启动、无法停止的问题；xterm 主题改读 CSS 变量。
  - 「打开位置」菜单 ◆/📁 换 SVG；删除死代码 `mockFiles`/`isAbsolutePath`。
- `ui/js/app.js`：置顶会话 `📌` 前缀换 `.session-pin` SVG + 标题 span。
- `src-tauri/src/external_terminal.rs` + `lib.rs`：新增 `powershell_terminal_close`
  命令（可按 id 关单个，缺省关全部），cargo check 通过。

### 自测反馈修正

1. 生图模型选择位置：从整宽 main-top 移回对话子面板顶部（并修复原生 select 露出）。
2. external 右栏：从固定三标签改为常规聊天的浏览器式标签页（可开关、+ 菜单、
   终端随标签启停）。
3. 工作区标签宽度：删除 `flex: 0 1 180px` 旧规则，标签内容自适应、与聊天一致。
4. 会话大纲 rail 统一重做（2026-07-26）：`chat-rail.js` 改为 `createChatRail` 工厂并挂
   `window.ChatRail`；右缘移到主区左缘，形态对齐 Gemini 会话大纲（3px 圆杠、连续 28×16
   命中区、rail hover 整体加深、tip 移到右侧）；scrollspy 修复「滚动到底高亮停在倒数第二条」
   （顶/底强制首/末项 + 35% 探针）；生图时间线接入（消息补 `data-message-id`）、external
   删除私有 rail 实现改用共享组件（tip 摘要随之补齐）。

### 遗留

- Pi / Claude Code 仍为 UI 占位（mock 数据），接真实连接时数据源可直接替换。
- app.css 常规聊天区段存在少量 10px mono 小标签（附件扩展名徽标等），属基线原状，
  未在本次范围内调整。
