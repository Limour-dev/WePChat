# WePChat Windows 设计规范

更新时间：2026-07-25

本文是 WePChat Windows 唯一的界面设计规范。任何新页面、新模式、新组件在动手前先读一遍；
写完后用文末的「新页面自查清单」过一遍。规范的基准是常规聊天模式——它定义了本产品的
视觉密度、留白节奏与交互语气，其他模式向它对齐，而不是各自发明。

产品定位约束（影响设计决策）：轻量、克制、快捷。界面上表现为：

- **能不加的都不加**：没有分割线也能分清区域时，不画分割线；没有标题也能理解的区块，不加标题。
- **能复用的必须复用**：新界面先在本文「组件清单」里找现成组件；找不到才允许新造，且新造的要回写进本文。
- **不做视觉惊喜**：全局只有中性墨色 + 少量语义色。不引入新颜色、渐变、emoji、装饰性图形。

---

## 1. 设计令牌（Design Tokens）

全部定义在 `ui/css/app.css` 顶部 `:root` / `html.dark` / `html[data-theme]`。
**任何 CSS 不允许写死颜色**（阴影里的黑色透明度、diff 语义色 mix 除外），必须引用 token，
否则暖纸 / 星云 / 深色主题会碎掉。

### 1.1 颜色

| Token | 用途 |
| --- | --- |
| `--bg` | 页面 / 卡片主背景，主区域和弹层都用它 |
| `--bg2` | 次级背景：代码块底、只读输入框、嵌入面板 |
| `--surface` | 交互面：hover 背景、搜索框底、气泡底、选中态 |
| `--surface2` | surface 的加深一档：active 态、次级选中 |
| `--surface-hover` / `--surface-active` | surface 自身的 hover / active |
| `--text` / `--text2` / `--text3` | 正文 / 次要文字 / 弱化文字（占位、时间、路径） |
| `--border` | 结构性边框（面板分界、卡片描边） |
| `--border-soft` | 弱分隔（卡片内行分隔、可选的细线） |
| `--accent` / `--accent-fg` | 主操作底色 / 其上文字（墨白主题下是近黑 + 白） |
| `--danger` `--success` `--warning` `--info` | 语义色，只用于状态，不用于装饰 |
| `--link` | 链接 |
| `--bubble-user` | 用户气泡底色 |
| `--code-bg` / `--code-head` | 代码块正文 / 头部 |
| `--rail*` | 最左图标轨专用（深底反白） |

语义色淡底的写法统一用 `color-mix(in srgb, var(--成分色) N%, transparent)`，N 取 8–14。

### 1.2 圆角

| 级别 | 值 | 用在哪 |
| --- | --- | --- |
| `--radius` 16px | 大卡片、欢迎标记 |
| `--radius-sm` 12px | 设置卡片、代码块、工具卡、主按钮 |
| `--radius-xs` 10px | 输入框、弹层、tool-btn |
| 8px | 菜单项、列表项、secondary-btn、小图标钮 |
| 7px | 弹层内 option、消息操作钮 |
| `999px` | 搜索框、尺寸胶囊、toast、状态徽标 |
| `50%` | 发送钮、头像位、旋转指示 |
| 22px | 输入框 composer 外壳（专属，勿挪用） |

**禁止出现 4/5/6px 圆角**

### 1.3 字号

| 值 | 用途 |
| --- | --- |
| 14.5px | 聊天正文 |
| 14px | 全局基准、输入框、模型选择按钮 |
| 13–13.5px | 列表项、设置行标题、次级按钮、菜单主文字 |
| 12–12.5px | 说明文字、菜单辅助行、代码（mono 12.5） |
| 11–11.5px | 弱化标注：时间、路径、组标题、状态文字 |
| 10.5px | **下限**，只允许 mono 路径 / meta 用 |

**任何界面不允许出现 <10.5px 的字号。** 旧 external 模式的 9.5/10px 已全部废弃。
中文界面不用 `text-transform: uppercase` 之外的变形；组标题（`.sec-label`）11px/650/letter-spacing 0.04em。

### 1.4 阴影与弹层层级

| Token / 值 | 用途 |
| --- | --- |
| `--soft-shadow` | 卡片静置微影 |
| `--raised` | 悬浮小件（tip、回底按钮） |
| `--composer-shadow` | 输入框外壳 |
| `0 14px 40px rgba(0,0,0,.16)` | 下拉弹层（model-picker 系） |
| `0 12px 36px rgba(0,0,0,.18)` | 右键菜单 |
| `0 24px 70px rgba(15,23,42,.28)` | 模态 dialog |

z-index 阶梯：面板 2–6 · 弹出菜单 20–40 · 顶部弹层 60–80 · 右键菜单 200 · toast 1000。

### 1.5 动效

- 缓动一律 `var(--ease)`（cubic-bezier(0.22,1,0.36,1)）。
- 时长：hover/按压 0.12–0.15s；展开/位移 0.16–0.2s；入场 fade-up 0.28s。
- 弹层出现 = opacity + translateY(−6px→0) + scale(0.98→1)，参考 `.model-picker-popover`。
- 尊重 `prefers-reduced-motion`（已有先例：流式指示条）。

### 1.6 间距节奏

基准 4 的倍数，常用 6/8/10/12/14/16/18。面板内边距横向 14–18px；
`.main-top` 为 `12px 18px`；列表项内边距 `9px 10px`。不使用 4px 以下的间距做视觉分隔。

---

## 2. 布局骨架

```
titlebar (36px)
app-body
  rail (56px 深底图标轨)
  list-pane (268px, --list-w, 可折叠/拖宽)
  main (弹性)
  right-pane (360px / 560px 宽档, 按需出现)
```

**每个模式的 main 列都必须遵守同一骨架：**

```
.main-view
  header.main-top     min-height 52px，padding 12px 18px，无底边框
  <滚动内容区>         flex:1, 内容列宽 min(720px, 100%) 居中
  footer(composer)    max-width 720px 居中
```

- `.main-top` 是三段网格 `1fr auto 1fr`：左侧上下文 / 中间主选择器 / 右侧工具钮。
  **不加 border-bottom**——常规聊天没有，其他模式也不许有。区域靠留白分层。
- 内容列宽统一 **720px**（`.chat-inner`）。不要 760/780 等私有值。
- 分栏工作台（如生图的「对话 | 画布」）：`main-top / 内容 / composer` 三段骨架落在
  **对话子面板内部**，而不是横跨整个 main——模型选择等控件必须待在它所控制的那一列上方；
  画布等工作面用底色深浅（`--bg` vs `--bg2`）分界，不画竖线。
- 左栏顶部结构统一：`(可选)list-header` → `.list-search`（胶囊搜索）→ 主操作 → `.list-body` 列表。
- 右栏只有一种壳：`.rp-tabbar` + 内容区，且**必须用标签页模型**——标签是内容自适应宽度的
  `.rp-tab`（label + `.rp-tab-close`），通过 `.rp-tab-add` 的「+」菜单按需打开、可随时关闭；
  无标签时显示 `.rp-tools` 入口列表。新模式只换标签种类（如 external 的 终端/文件/审阅），
  不新造侧栏、不做固定宽度标签。有进程开销的标签（终端）生命周期跟随标签：
  打开标签才启动进程，关闭标签必须结束进程。
- 分割线原则：**三栏之间的 1px 分界（list-pane 右缘、right-pane 左缘）是仅有的两条结构线**。
  main 列内部不允许再出现横贯整列的分割线；小区域分隔用 `--border-soft` 且尽量以留白替代。

---

## 3. 组件清单（先查这里，再写新的）

### 3.1 按钮

| 类 | 形态 | 用途 |
| --- | --- | --- |
| `.primary-btn` | accent 底、12px 圆角 | 每屏至多一个的主操作 |
| `.secondary-btn` | 1px 边、8px 圆角、12px 字 | 次级操作 |
| `.danger-text-btn` | 无边红字 | 破坏性入口 |
| `.icon-btn` | 32×32 / r9 | 通用图标钮 |
| `.tool-btn` | 34×34 / r10 | main-top 右侧工具钮，`.is-active` 表示面板开着 |
| `.send-btn` | 34 圆形 | 发送；`.is-ready` 变 accent；`.is-stop` 停止态 |
| `.seg` + `.seg-btn(.is-on)` | 胶囊分段 | 二至四段互斥选择（权限、显示模式、参考/编辑） |
| `.switch(.on)` | 40×24 开关 | 布尔设置 |

hover 语言统一：透明底 → `var(--surface)`；文字 `--text2/3 → --text`。**不用边框变色表达 hover**。

### 3.2 输入

| 类 | 形态 |
| --- | --- |
| `.composer-box` | 聊天输入外壳：bg 底、1px border、**22px 圆角**、`--composer-shadow`，内含 icon-btn + textarea + send-btn |
| `.list-search input` | 胶囊搜索：surface 底、无边框、999 圆角 |
| `.field` + `.field-label` + `.field-input` | 设置表单；mono 变体加 `.mono` |

任何模式的聊天输入都必须复用 `.composer-box`（可加模式类做微调），不允许重新实现输入外壳。

### 3.3 弹层与菜单

| 类 | 用途 |
| --- | --- |
| `.model-picker-popover` 系 | 锚定下拉：bg 底、r10、p6、大投影；分组 `.model-picker-group(-title)`；选项 `.model-picker-option`（r7，主行 13px + 辅行 11px） |
| `.context-menu` | 右键菜单 |
| `.session-menu` | 列表项「⋯」菜单 |
| dialog：`.app-dlg` / `.provider-dialog` | 模态；确认/输入一律走 `UIDialog`，不用原生 alert |

新的下拉一律套 model-picker 的结构与度量（外壳 r10/p6/大投影，选项 r7、13px+11px 两行）。

### 3.4 列表与卡片

| 类 | 用途 |
| --- | --- |
| `.session-item(-btn/-more/-row)` | 左栏列表项：13px、r8、hover surface；置顶 `.is-pinned` 加粗 + `.session-pin` 图标 |
| `.settings-card` + `.settings-row` | 设置页卡片行 |
| `.tool-card` | 聊天内工具执行卡：r10、bg2、可展开 |
| `.attachment-chip` / `.chat-attachment-chip` | 附件条：34px 缩略 + 名称 + 路径 |
| `.chat-image-grid` + `.chat-image-card` | 生成图缩略卡（生图时间线用 150px 窄版） |
| `.rp-tab` + `.rp-tab-close` / `.rp-tab-add` + `.rp-add-menu` / `.rp-tools`+`.rp-tool` | 右栏标签壳：内容自适应标签、「+」添加菜单、无标签时的入口列表。chat 与 external 共用同一套 |
| `.rp-tree-item` | 右栏文件树行 |

### 3.5 消息（所有对话类界面共用）

- 容器 `.chat-message` + `--user` / `--assistant`，正文 `.chat-message-body`。
- 用户：右对齐气泡，`--surface` 底，圆角 `18px 18px 6px 18px`，`max-width: min(86%, 520px)`。
- 助手：**无气泡**，全宽正文，Markdown 走 `window.MD`。
- 无头像、无角色名、无常驻时间戳；元信息进 hover 出现的 `.msg-actions` / `.msg-meta`。
- 流式光标、typing-dot、`.chat-reasoning` 折叠已有实现，直接用。
- **会话大纲 rail**（`.chat-rail` 系，`chat-rail.js` 的 `createChatRail` 工厂）：主区**左缘**的
  消息定位条，每条用户提问一根 3px 圆杠，命中区 28×16 连续；hover 右侧浮出摘要 tip，
  scrollspy 高亮（顶/底强制首/末项）。三模式共用一个实现，消息节点带
  `data-message-id`（或等价属性）即可接入；不允许再手写私有版本。

生图 / external agent 的消息列表已复用同一套类；新模式同样不许另写消息样式。

### 3.6 状态与空态

| 类 | 用途 |
| --- | --- |
| `.welcome(-mark/-brand/-sub)` | 模式首屏空态：48px 圆角标记 + 主标题 + 弱副题 |
| `.empty-hint(-title/-desc)` | 左栏列表空态 |
| `.rp-empty` | 右栏空态 |
| `.status-dot`（`.external-runtime-state` 范式） | 文字前 5–6px 圆点 + 11px 状态文字；语义色只上点和文字 |
| `.token-meter` / `.external-context-meter` | conic-gradient 圆环用量表 |
| `.mini-spinner` / `.img-canvas-spinner` | 加载旋转 |
| `#wc-toast`（`UIDialog.toast`） | 轻提示 |

### 3.7 图标

- 一律内联 SVG：`viewBox="0 0 24 24"`、`fill="currentColor"`、无内置颜色（品牌 logo 除外）。
- 尺寸档：主导航 20 · 工具钮 17–18 · 菜单/列表 14–16 · 微图标 12–13。
- **界面文案与图标禁止使用 emoji**（📌 ✋ 📁 ◆ 之类一律换 SVG）。
  唯一例外：主题选择的 `✓` 与「⋯」「×」这类排版符号。
- 常用图标直接从 `index.html` / 各 js 里已有的 path 复制，保持同一套 Material 风格线条。

---

## 4. 文案语气

- 简体中文，克制、具体，不用感叹号、不卖萌。空态给「下一步动作」而非抱歉。
- 中英文与数字之间空格：`Codex 会话` / `3 个文件`。省略号用 `…`。
- 按钮用动词或动宾：`添加项目`、`允许一次`；不用「点击这里」。
- 弱化信息（路径、模型 id）用 `var(--mono)`。

---

## 5. 新页面自查清单

动手前：

1. 这个页面在三栏骨架里占哪格？main 列是否是「main-top / 内容 / composer」三段？
2. 需要的每个控件，§3 里是否已有？——有就复用类名，没有才新写并回写本文。

提交前：

- [ ] 没有写死的颜色 / 字体；全部走 token
- [ ] 没有 <10.5px 字号；没有 4/5/6px 圆角
- [ ] main 列内没有新增横贯分割线；`.main-top` 无底边框
- [ ] 内容列宽 720px；左栏搜索是胶囊；弹层套 model-picker 度量
- [ ] hover 全部是「透明→surface」语言
- [ ] 图标全部 SVG currentColor；无 emoji
- [ ] 深色 + 暖纸 + 星云三主题下过一遍（改 `data-theme` / `html.dark`）
- [ ] 交互文案过一遍 §4

---

## 6. 反例存档（2026-07 统一重构中修掉的问题，勿再犯）

1. **复用退化**：external / 生图各自重写了 composer、下拉菜单、消息气泡的「劣化版」
   （8px 圆角输入壳、9.5px 菜单字、bg2 弹层底、固定 180px 宽的右栏标签）。→ 现已全部指回共享组件。
2. **多余线条**：external 顶栏 border-bottom、列表 footer 分隔线、工具步骤重边框；
   生图面板 header 底线。→ 全部删除，靠留白与底色分层。
3. **字号失控**：9.5/10/10.5px 三档挤在一个菜单里。→ 收敛到 §1.3 阶梯。
4. **emoji 当图标**：📌（置顶）、✋（抓手）、📁/◆（打开方式）。→ SVG。
5. **死代码**：`.external-main-top`、`.external-runtime-state` 双重定义，
   mock 时代的终端/文件样式残留。→ 重写时清除；以后删功能必须同步删样式。
