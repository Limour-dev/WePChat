import { $, $all, cloneJson, defaultSettings, uid } from './app-core.js';
import { createChatRail } from './chat-rail.js';

const MOCK_STORAGE_KEY = 'wepchat:external-agent-ui-mock:v1';

const AGENTS = [
  {
    kind: 'codex',
    label: 'Codex',
    models: ['gpt-5.4', 'gpt-5.3-codex'],
  },
  {
    kind: 'pi',
    label: 'Pi',
    models: ['claude-sonnet-4.5', 'gpt-5.4'],
  },
  {
    kind: 'claude',
    label: 'Claude Code',
    models: ['claude-sonnet-4.5', 'claude-opus-4.1'],
  },
];

const CODEX_PERMISSIONS = {
  request: {
    label: '请求批准',
    description: '编辑、网络和受限操作请求批准',
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
    sandboxPolicy: (project) => ({ type: 'workspaceWrite', writableRoots: [project.path], networkAccess: false }),
  },
  onFailure: {
    label: '替我批准',
    description: '仅在沙箱无法完成时请求批准',
    approvalPolicy: 'on-failure',
    sandbox: 'workspace-write',
    sandboxPolicy: (project) => ({ type: 'workspaceWrite', writableRoots: [project.path], networkAccess: false }),
  },
  fullAccess: {
    label: '完全访问权限',
    description: '不受限制地访问设备和网络',
    approvalPolicy: 'never',
    sandbox: 'danger-full-access',
    sandboxPolicy: () => ({ type: 'dangerFullAccess' }),
  },
};

const CLAUDE_PERMISSIONS = {
  request: {
    label: '请求批准',
    description: '危险操作需要你的批准',
    mode: 'default',
  },
  onFailure: {
    label: '替我批准',
    description: '自动接受文件编辑，其余仍需批准',
    mode: 'acceptEdits',
  },
  fullAccess: {
    label: '完全访问权限',
    description: '跳过所有权限检查',
    mode: 'bypassPermissions',
  },
};

const ICONS = {
  codex: `
    <svg class="agent-brand-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#0080F7"/>
      <path fill="#fff" d="M9.9449 9.5916V8.1323c0-.1229.0461-.2152.1536-.2765l2.9342-1.6898c.3994-.2304.8756-.3379 1.3671-.3379 1.8434 0 3.011 1.4287 3.011 2.9494 0 .1075 0 .2304-.0155.3533l-3.0416-1.782c-.1843-.1075-.3687-.1075-.553 0L9.9449 9.5916Zm6.8514 5.6839v-3.4872c0-.2151-.0923-.3687-.2766-.4762L12.664 9.0693l1.2596-.722c.1075-.0614.1998-.0614.3072 0l2.9342 1.6897c.8449.4917 1.4132 1.5362 1.4132 2.55 0 1.1674-.6912 2.2428-1.7819 2.6885ZM9.0386 12.2031 7.779 11.4658c-.1075-.0613-.1536-.1536-.1536-.2765V7.8098c0-1.6437 1.2597-2.888 2.9649-2.888.6452 0 1.2442.2151 1.7513.5991L9.3153 7.2722c-.1843.1075-.2765.2611-.2765.4762v4.4549Zm2.7114 1.5669-1.8051-1.0138v-2.1506L11.75 9.5918l1.8049 1.0138v2.1506L11.75 13.77Zm1.1598 4.67c-.6453 0-1.2443-.2151-1.7513-.5991l3.0262-1.7513c.1843-.1075.2765-.2611.2765-.4762v-4.4549l1.2751.7373c.1075.0614.1536.1536.1536.2765v3.3796c0 1.6436-1.2751 2.8881-2.9801 2.8881ZM9.269 15.0144l-2.9341-1.6898c-.845-.4916-1.4133-1.5361-1.4133-2.55 0-1.1828.7066-2.2428 1.7973-2.6883v3.5024c0 .2152.0922.3688.2765.4763l3.8405 2.2273-1.2597.7221c-.1075.0614-.1997.0614-.3072 0Zm-.1689 2.5193c-1.7358 0-3.0109-1.3058-3.0109-2.9188 0-.1229.0154-.2458.0307-.3687l3.0262 1.7513c.1843.1075.3687.1075.553 0l3.8558-2.2273v1.4593c0 .1229-.0461.2151-.1536.2765l-2.9342 1.6898c-.3994.2304-.8756.3379-1.367.3379Zm3.8097 1.8279c1.8587 0 3.4102-1.321 3.7637-3.0723C18.3939 15.8438 19.5 14.2308 19.5 12.5872c0-1.0754-.4609-2.1199-1.2904-2.8726.0768-.3227.123-.6453.123-.9678 0-2.1967-1.7821-3.8405-3.8405-3.8405-.4147 0-.8142.0614-1.2136.1998C12.5872 4.4301 11.6347 4 10.5902 4 8.7314 4 7.18 5.321 6.8265 7.0723 5.1061 7.5179 4 9.1308 4 10.7745c0 1.0753.4608 2.1199 1.2904 2.8726-.0769.3226-.123.6452-.123.9677 0 2.1966 1.782 3.8404 3.8405 3.8404.4147 0 .8141-.0613 1.2136-.1996.6912.6759 1.6436 1.106 2.6883 1.106Z"/>
    </svg>`,
  pi: `
    <svg class="agent-brand-icon" viewBox="0 0 800 800" aria-hidden="true">
      <rect width="800" height="800" rx="120" fill="#09090b"/>
      <path fill="#fff" fill-rule="evenodd" d="M165.29 165.29h352.07V400H400v117.36H282.65v117.36H165.29V165.29Zm117.36 117.36V400H400V282.65H282.65Z"/>
      <path fill="#fff" d="M517.36 400h117.36v234.72H517.36Z"/>
    </svg>`,
  claude: `
    <svg class="agent-brand-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#D97757" d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/>
    </svg>`,
};

let deps = null;
let detection = [];
let activeKind = 'codex';
let workspaceTabs = [];
let activeWorkspaceTab = '';
let mockData = loadMockData();
let responseTimer = 0;
let codexModels = [];
let codexReadyPromise = null;
let codexUnlisten = null;
let claudeModels = [];
let claudeUnlisten = null;
let claudeRenderTimer = 0;
let powerShellUnlisten = null;
let xtermSession = null;
let composerAttachments = [];
let projectOpenTargets = null;
const codexReadyThreads = new Set();
const codexFileCache = new Map();
const claudeAliveKeys = new Set();
const claudeStartPromises = new Map();
const powerShellBuffers = new Map();

/** codex 与 claude 走真实连接；pi 仍是 mock。 */
function isLiveKind(kind = activeKind) {
  return kind === 'codex' || kind === 'claude';
}

function appendPowerShellOutput(terminalId, text) {
  const buffer = `${powerShellBuffers.get(terminalId) || ''}${text || ''}`;
  powerShellBuffers.set(terminalId, buffer.slice(-500_000));
}

function disposeXterm() {
  if (!xtermSession) return;
  xtermSession.resizeObserver?.disconnect();
  xtermSession.dataDisposable?.dispose();
  xtermSession.terminal.dispose();
  xtermSession = null;
}

function syncXtermSize() {
  if (!xtermSession) return;
  xtermSession.fitAddon.fit();
  const { terminal, terminalId } = xtermSession;
  deps.invoke('powershell_terminal_resize', {
    terminalId,
    cols: terminal.cols,
    rows: terminal.rows,
  }).catch(() => {});
}

function mountXterm(project) {
  if (!project) return;
  const host = $('#external-xterm');
  if (!host || !window.Terminal || !window.FitAddon?.FitAddon) return;
  if (xtermSession?.terminalId === project.path && xtermSession.host === host) return;
  disposeXterm();
  const rootStyle = getComputedStyle(document.documentElement);
  const cssColor = (name, fallback) => (rootStyle.getPropertyValue(name) || '').trim() || fallback;
  const terminal = new window.Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: 'Cascadia Mono, Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.25,
    scrollback: 5000,
    theme: {
      background: cssColor('--code-bg', '#101114'),
      foreground: cssColor('--text', '#e5e7eb'),
      cursor: cssColor('--text', '#e5e7eb'),
    },
  });
  const fitAddon = new window.FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(host);
  const dataDisposable = terminal.onData((data) => {
    deps.invoke('powershell_terminal_write', { terminalId: project.path, data })
      .catch((error) => terminal.write(`\r\n\x1b[31m${error?.message || error}\x1b[0m\r\n`));
  });
  const resizeObserver = new ResizeObserver(() => syncXtermSize());
  resizeObserver.observe(host);
  xtermSession = { terminalId: project.path, host, terminal, fitAddon, dataDisposable, resizeObserver };
  const buffered = powerShellBuffers.get(project.path);
  if (buffered) terminal.write(buffered);
  requestAnimationFrame(() => {
    syncXtermSize();
    deps.invoke('powershell_terminal_open', {
      terminalId: project.path,
      cols: terminal.cols,
      rows: terminal.rows,
    }).catch((error) => terminal.write(`\r\n\x1b[31m无法启动 PowerShell：${error?.message || error}\x1b[0m\r\n`));
    terminal.focus();
  });
}

function handlePowerShellEvent(payload = {}) {
  const text = payload.kind === 'error' ? `\r\n\x1b[31m${payload.text || ''}\x1b[0m\r\n` : payload.text || '';
  if (payload.kind === 'closed') return;
  appendPowerShellOutput(payload.terminalId, text);
  if (xtermSession?.terminalId === payload.terminalId) {
    xtermSession.terminal.write(text);
  }
}

function agentMeta(kind = activeKind) {
  return AGENTS.find((item) => item.kind === kind) || AGENTS[0];
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function icon(kind) {
  return ICONS[kind] || '';
}

function selectedCodexModel() {
  return codexModels.find((model) => model.id === mockData.codex.model) || codexModels[0] || null;
}

function supportedEfforts(model = selectedCodexModel()) {
  return (model?.supportedReasoningEfforts || []).map((item) => item?.reasoningEffort || item).filter(Boolean);
}

function effortLabel(value) {
  return ({ none: '无', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最大' })[value] || '';
}

function permissionTable(kind = activeKind) {
  return kind === 'claude' ? CLAUDE_PERMISSIONS : CODEX_PERMISSIONS;
}

function permissionProfile() {
  const table = permissionTable();
  return table[currentAgentState().permission] || table.request;
}

function closeExternalPopovers(except = null) {
  ['external-open-menu', 'external-permission-menu', 'external-model-menu'].forEach((id) => {
    const menu = $(`#${id}`);
    if (!menu || menu === except) return;
    menu.hidden = true;
  });
  ['external-open-project', 'external-permission-toggle', 'external-model-toggle'].forEach((id) => {
    const button = $(`#${id}`);
    if (button) button.setAttribute('aria-expanded', 'false');
  });
}

function toggleExternalPopover(menuId, buttonId) {
  const menu = $(`#${menuId}`);
  const button = $(`#${buttonId}`);
  if (!menu || !button || button.disabled) return;
  const open = menu.hidden;
  closeExternalPopovers(menu);
  menu.hidden = !open;
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

function renderMessageCopy(message) {
  if (message.role === 'assistant' && window.MD?.render) {
    return message.pending && window.MD.renderStreaming
      ? window.MD.renderStreaming(message.content || '')
      : window.MD.render(message.content || '');
  }
  // 用户气泡 .chat-message-body 自带 pre-wrap，换行无需 <br>
  return escapeHtml(message.content || '');
}

function renderMessageAttachments(message) {
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (!attachments.length) return '';
  return `<div class="external-message-attachments">${attachments.map((attachment) => `
    <img src="${escapeHtml(attachment.url)}" alt="${escapeHtml(attachment.name || '图片附件')}" title="${escapeHtml(attachment.name || '')}" />
  `).join('')}</div>`;
}

function prepareExternalLinks(host) {
  host?.querySelectorAll('a[href]').forEach((link) => {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
}

function seedMessages(kind) {
  const label = agentMeta(kind).label;
  return [
    {
      id: uid('eam'),
      role: 'user',
      content: '先梳理现有聊天壳层，再完善外部 Agent 的三栏交互。暂时只做 UI 和少量 mock 数据。',
      time: '10:24',
    },
    {
      id: uid('eam'),
      role: 'assistant',
      content: `我会沿用 WePChat 的消息区和可伸缩壳层，把 ${label} 作为项目化工作区接入。当前不会启动本地进程。`,
      time: '10:25',
      steps: [
        { title: '读取项目结构', detail: 'ui/index.html · ui/js/app.js · ui/css/app.css', status: 'done' },
        { title: '分析可复用布局', detail: '左栏、消息滚动、右侧标签与拖拽能力', status: 'done' },
      ],
      changes: [
        { path: 'ui/js/external-agent-mode.js', added: 186, removed: 24 },
        { path: 'ui/css/app.css', added: 142, removed: 0 },
      ],
    },
    {
      id: uid('eam'),
      role: 'user',
      content: '右侧需要终端、文件和审阅三个标签，项目切换时内容要一起更新。',
      time: '10:31',
    },
    {
      id: uid('eam'),
      role: 'assistant',
      content: '已补齐标签式工作区。终端目前只返回演示输出，文件和 diff 也使用项目内 mock 数据；接入真实连接时可以直接替换数据源。',
      time: '10:32',
    },
  ];
}

function createSeedData() {
  const base = {
    codex: {
      selectedSessionId: 'codex-session-ui',
      model: 'gpt-5.4',
      effort: '',
      permission: 'request',
      context: 0,
      contextKnown: false,
      projects: [
        {
          id: 'codex-project-wepchat',
          name: 'wepchat-win',
          path: 'E:\\wepchat\\wepchat\\wepchat-win',
          open: true,
          sessions: [
            { id: 'codex-session-ui', title: '完善外部 Agent UI', updated: '刚刚', messages: seedMessages('codex') },
            { id: 'codex-session-rpc', title: '梳理 app-server 协议', updated: '昨天', messages: [] },
          ],
        },
        {
          id: 'codex-project-notes',
          name: 'agent-notes',
          path: 'E:\\workspace\\agent-notes',
          open: false,
          sessions: [
            { id: 'codex-session-roadmap', title: '连接层路线图', updated: '7月22日', messages: [] },
          ],
        },
      ],
    },
    pi: {
      selectedSessionId: 'pi-session-reference',
      model: 'claude-sonnet-4.5',
      context: 12,
      projects: [
        {
          id: 'pi-project-desktop',
          name: 'PiDesktop',
          path: 'E:\\wepchat\\wepchat\\wepchat-win\\example\\PiDesktop',
          open: true,
          sessions: [
            { id: 'pi-session-reference', title: '提取桌面工作区设计', updated: '刚刚', messages: seedMessages('pi') },
            { id: 'pi-session-terminal', title: '终端会话设计', updated: '周三', messages: [] },
          ],
        },
      ],
    },
    claude: {
      selectedSessionId: 'claude-session-shell',
      model: '',
      effort: '',
      permission: 'request',
      context: 0,
      contextKnown: false,
      projects: [
        {
          id: 'claude-project-wepchat',
          name: 'wepchat-win',
          path: 'E:\\wepchat\\wepchat\\wepchat-win',
          open: true,
          sessions: [
            { id: 'claude-session-shell', title: '评审三栏交互', updated: '刚刚', messages: seedMessages('claude') },
          ],
        },
      ],
    },
  };
  return base;
}

function loadMockData() {
  const fallback = createSeedData();
  try {
    const saved = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return fallback;
    AGENTS.forEach(({ kind }) => {
      if (!saved[kind]?.projects?.length) saved[kind] = fallback[kind];
      saved[kind].permission ||= kind === 'pi' ? '' : 'request';
      saved[kind].effort ||= '';
      saved[kind].contextKnown = !!saved[kind].contextKnown;
    });
    return saved;
  } catch {
    return fallback;
  }
}

function persistMockData() {
  try {
    localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(mockData));
  } catch {
    // WebView storage may be unavailable; the current in-memory preview still works.
  }
}

function settings() {
  return deps?.getState?.().settings || defaultSettings();
}

function externalSettings() {
  const base = cloneJson(defaultSettings().externalConnections);
  const current = settings().externalConnections || {};
  const next = {
    ...base,
    ...current,
    agents: { ...(base.agents || {}), ...(current.agents || {}) },
    projects: { ...(base.projects || {}), ...(current.projects || {}) },
  };
  AGENTS.forEach((agent) => {
    next.agents[agent.kind] ||= { enabled: false, commandPath: null, extraArgs: [], env: {} };
    next.projects[agent.kind] ||= [];
  });
  return next;
}

function setPressed(btn, on) {
  if (!btn) return;
  btn.classList.toggle('on', !!on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function agentDetection(kind) {
  return detection.find((item) => item.kind === kind) || null;
}

function readExternalSettingsFromUi() {
  const next = externalSettings();
  next.enabled = $('#external-enabled')?.getAttribute('aria-pressed') === 'true';
  AGENTS.forEach((agent) => {
    next.agents[agent.kind] ||= { enabled: false, commandPath: null, extraArgs: [], env: {} };
    next.agents[agent.kind].enabled = $(`#external-${agent.kind}-enabled`)?.getAttribute('aria-pressed') === 'true';
    next.agents[agent.kind].commandPath = ($(`#external-${agent.kind}-path`)?.value || '').trim() || null;
    next.agents[agent.kind].extraArgs = Array.isArray(next.agents[agent.kind].extraArgs) ? next.agents[agent.kind].extraArgs : [];
    if (agent.kind === 'codex') next.agents[agent.kind].extraArgs = next.agents[agent.kind].extraArgs.filter((arg) => String(arg).trim() !== '--acp');
    next.agents[agent.kind].env = next.agents[agent.kind].env || {};
  });
  return next;
}

function syncNavigation(source = externalSettings()) {
  AGENTS.forEach((agent) => {
    const visible = !!source.enabled && !!source.agents?.[agent.kind]?.enabled;
    const button = $(`[data-agent-rail="${agent.kind}"]`);
    if (button) button.hidden = !visible;
    if (!visible && deps?.getState?.().mode === `agent-${agent.kind}`) deps.setMode?.('chat');
  });
}

function renderAgentToggleAvailability() {
  const masterEnabled = $('#external-enabled')?.getAttribute('aria-pressed') === 'true';
  const list = $('#external-agent-list');
  list?.classList.toggle('is-disabled', !masterEnabled);
  AGENTS.forEach((agent) => {
    const toggle = $(`#external-${agent.kind}-enabled`);
    const path = $(`#external-${agent.kind}-path`);
    if (toggle) toggle.disabled = !masterEnabled;
    if (path) path.disabled = !masterEnabled;
  });
}

async function saveSettings() {
  const status = $('#external-status');
  const appState = deps.getState();
  const previousExternal = externalSettings();
  const nextExternal = readExternalSettingsFromUi();
  appState.settings = {
    ...defaultSettings(),
    ...(appState.settings || {}),
    providers: appState.providers || [],
    externalConnections: nextExternal,
  };
  if (status) status.textContent = '保存中...';
  await deps.persistSettings();
  const codexConfigChanged = previousExternal.agents?.codex?.commandPath !== nextExternal.agents?.codex?.commandPath;
  if (!nextExternal.enabled || !nextExternal.agents?.codex?.enabled || codexConfigChanged) {
    await deps.invoke('codex_disconnect').catch(() => {});
    codexReadyPromise = null;
    codexReadyThreads.clear();
    codexFileCache.clear();
    clearCodexRuntime(false);
    mockData.codex.connectionStatus = 'disconnected';
  }
  const claudeConfigChanged = previousExternal.agents?.claude?.commandPath !== nextExternal.agents?.claude?.commandPath;
  if (!nextExternal.enabled || !nextExternal.agents?.claude?.enabled || claudeConfigChanged) {
    await deps.invoke('claude_stop_all').catch(() => {});
    claudeAliveKeys.clear();
    claudeStartPromises.clear();
    claudeModels = [];
    clearClaudeRuntime(false);
    mockData.claude.connectionStatus = 'disconnected';
  }
  syncNavigation(nextExternal);
  if (status) status.textContent = '已保存';
  window.UIDialog?.toast?.('外部连接设置已保存');
}

async function detect(kind) {
  const agent = agentMeta(kind);
  const button = $(`[data-external-detect="${kind}"]`);
  const status = $(`#external-${kind}-status`);
  if (button) button.disabled = true;
  if (status) {
    status.textContent = `正在检测 ${agent.label}...`;
    status.title = '';
  }
  try {
    const result = await deps.invoke('external_agent_detect', { kind });
    detection = detection.filter((item) => item.kind !== kind);
    if (result) detection.push(result);
    renderSettings();
  } catch (error) {
    if (status) {
      status.textContent = '检测失败';
      status.title = error?.message || String(error);
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function renderSettings() {
  const s = externalSettings();
  setPressed($('#external-enabled'), s.enabled);
  $all('[data-agent-brand], [data-agent-icon]').forEach((mark) => {
    mark.innerHTML = icon(mark.dataset.agentBrand || mark.dataset.agentIcon);
  });
  AGENTS.forEach((agent) => {
    const config = s.agents?.[agent.kind] || {};
    setPressed($(`#external-${agent.kind}-enabled`), !!config.enabled);
    const path = $(`#external-${agent.kind}-path`);
    if (path) path.value = config.commandPath || '';
    const status = $(`#external-${agent.kind}-status`);
    if (!status) return;
    const found = agentDetection(agent.kind);
    if (!found) {
      status.textContent = '未检测';
      status.title = '';
    } else if (found.installed) {
      status.textContent = `已安装 · ${found.path || 'PATH'}${found.version ? ` · ${found.version}` : ''}`;
      status.title = [found.path, found.version].filter(Boolean).join('\n');
    } else {
      status.textContent = `未找到 ${found.command || agent.kind}`;
      status.title = found.error || '';
    }
  });
  renderAgentToggleAvailability();
  syncNavigation(s);
}

function currentAgentState() {
  return mockData[activeKind] || mockData.codex;
}

function findSession(sessionId = currentAgentState().selectedSessionId) {
  for (const project of currentAgentState().projects) {
    const session = project.sessions.find((item) => item.id === sessionId);
    if (session) return { project, session };
  }
  return null;
}

function findCodexSession(threadId) {
  if (!threadId) return null;
  for (const project of mockData.codex.projects) {
    const session = project.sessions.find((item) => item.threadId === threadId);
    if (session) return { project, session };
  }
  return null;
}

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function ensureSelection() {
  const agentState = currentAgentState();
  let found = findSession(agentState.selectedSessionId);
  if (found) return found;
  const project = agentState.projects.find((item) => item.sessions.length) || agentState.projects[0];
  if (!project) return null;
  if (!project.sessions.length) project.sessions.push(createSession('新会话'));
  agentState.selectedSessionId = project.sessions[0].id;
  return findSession(agentState.selectedSessionId);
}

function createSession(title) {
  return {
    id: uid(`${activeKind}_session`),
    title: String(title || '新会话').trim() || '新会话',
    updated: '刚刚',
    messages: [],
  };
}

function renderProjectTree() {
  const host = $('#external-project-tree');
  if (!host) return;
  const query = ($('#external-project-search')?.value || '').trim().toLowerCase();
  const selected = currentAgentState().selectedSessionId;
  host.innerHTML = '';

  currentAgentState().projects.forEach((project) => {
    const matchingSessions = project.sessions.filter((session) => !query || session.title.toLowerCase().includes(query));
    if (query && !project.name.toLowerCase().includes(query) && !matchingSessions.length) return;
    const visibleSessions = query ? (matchingSessions.length ? matchingSessions : project.sessions) : project.sessions;
    const group = document.createElement('section');
    group.className = 'external-project-group';
    group.dataset.projectId = project.id;
    group.innerHTML = `
      <div class="external-project-row${visibleSessions.some((item) => item.id === selected) ? ' has-active' : ''}">
        <button type="button" class="external-project-toggle" data-external-action="toggle-project" title="${project.open ? '收起项目' : '展开项目'}" aria-expanded="${project.open || !!query}">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="m8 10 4 4 4-4z"/></svg>
        </button>
        <button type="button" class="external-project-main" data-external-action="toggle-project" title="${escapeHtml(project.path)}">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M10 4l2 2h8c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2h6z"/></svg>
          <span>${escapeHtml(project.name)}</span>
          <small>${project.sessions.length}</small>
        </button>
        <span class="external-project-actions">
          <button type="button" data-external-action="new-session" title="新建会话" aria-label="在 ${escapeHtml(project.name)} 中新建会话">+</button>
          <button type="button" data-external-action="remove-project" title="移除项目" aria-label="移除 ${escapeHtml(project.name)}">&#215;</button>
        </span>
      </div>
      <div class="external-session-branch" ${project.open || query ? '' : 'hidden'}></div>
    `;
    const branch = group.querySelector('.external-session-branch');
    visibleSessions.forEach((session) => {
      const row = document.createElement('div');
      row.className = `external-session-row${session.id === selected ? ' is-active' : ''}`;
      row.dataset.sessionId = session.id;
      row.innerHTML = `
        <button type="button" class="external-session-main" data-external-action="open-session">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4 4h16v13H7l-3 3V4zm2 2v9.17L6.17 15H18V6H6z"/></svg>
          <span><strong>${escapeHtml(session.title)}</strong><small>${escapeHtml(session.updated || '')}</small></span>
        </button>
        <span class="external-session-actions">
          <button type="button" data-external-action="rename-session" title="重命名" aria-label="重命名会话">
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
          </button>
          <button type="button" data-external-action="delete-session" title="删除" aria-label="删除会话">
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm3.5-9h1v8h-1v-8zm4 0h1v8h-1v-8zM15.5 4l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </span>
      `;
      branch.appendChild(row);
    });
    if (!visibleSessions.length) branch.innerHTML = '<div class="external-tree-empty">暂无会话</div>';
    host.appendChild(group);
  });

  if (!host.children.length) host.innerHTML = '<div class="external-tree-empty external-tree-empty--search">没有匹配的项目或会话</div>';
}

function renderComposerAttachments() {
  const host = $('#external-composer-attachments');
  if (!host) return;
  host.hidden = !composerAttachments.length;
  host.innerHTML = composerAttachments.map((attachment) => `
    <span class="external-image-chip" title="${escapeHtml(attachment.name)}">
      <img src="${escapeHtml(attachment.url)}" alt="${escapeHtml(attachment.name)}" />
      <span>${escapeHtml(attachment.name)}</span>
      <button type="button" data-external-remove-attachment="${escapeHtml(attachment.id)}" title="移除图片" aria-label="移除图片">&times;</button>
    </span>`).join('');
}

function renderPermissionMenu() {
  const selected = currentAgentState().permission || 'request';
  const table = permissionTable();
  const label = $('#external-permission-label');
  if (label) label.textContent = permissionProfile().label;
  const menu = $('#external-permission-menu');
  if (!menu) return;
  menu.innerHTML = Object.entries(table).map(([id, profile]) => `
    <button type="button" class="external-menu-option${id === selected ? ' is-selected' : ''}" data-external-permission="${id}" role="menuitemradio" aria-checked="${id === selected}">
      <span><strong>${escapeHtml(profile.label)}</strong><small>${escapeHtml(profile.description)}</small></span>
      ${id === selected ? '<b aria-hidden="true">&#10003;</b>' : ''}
    </button>`).join('');
}

function selectedClaudeModel() {
  return claudeModels.find((model) => model.value === mockData.claude.model) || null;
}

function renderClaudeModelMenu(button, label, effort, menu) {
  const connected = claudeModels.length > 0;
  const model = selectedClaudeModel();
  if (button) button.disabled = !connected;
  if (label) label.textContent = model?.displayName || mockData.claude.currentModel || '模型';
  if (effort) effort.textContent = connected && mockData.claude.effort ? effortLabel(mockData.claude.effort) || mockData.claude.effort : '';
  if (!menu) return;
  if (!connected) {
    menu.innerHTML = '';
    return;
  }
  const efforts = model?.supportsEffort ? (model.supportedEffortLevels || []) : [];
  menu.innerHTML = `
    <div class="external-menu-section"><span>模型</span>${claudeModels.map((item) => `
      <button type="button" class="external-menu-option external-model-option${item.value === model?.value ? ' is-selected' : ''}" data-external-model="${escapeHtml(item.value)}" role="menuitemradio" aria-checked="${item.value === model?.value}">
        <strong>${escapeHtml(item.displayName || item.value)}</strong>${item.value === model?.value ? '<b aria-hidden="true">&#10003;</b>' : ''}
      </button>`).join('')}</div>
    ${efforts.length ? `<div class="external-menu-section"><span>推理强度</span>${efforts.map((value) => `
      <button type="button" class="external-menu-option external-model-option${mockData.claude.effort === value ? ' is-selected' : ''}" data-external-effort="${escapeHtml(value)}" role="menuitemradio" aria-checked="${mockData.claude.effort === value}">
        <strong>${escapeHtml(effortLabel(value) || value)}</strong>${mockData.claude.effort === value ? '<b aria-hidden="true">&#10003;</b>' : ''}
      </button>`).join('')}</div>` : ''}`;
}

function renderModelMenu() {
  const button = $('#external-model-toggle');
  const label = $('#external-model-label');
  const effort = $('#external-effort-label');
  if (activeKind === 'claude') {
    renderClaudeModelMenu(button, label, effort, $('#external-model-menu'));
    return;
  }
  const model = selectedCodexModel();
  const connected = activeKind === 'codex' && mockData.codex.connectionStatus === 'connected' && !!model;
  if (button) button.disabled = !connected;
  if (label) label.textContent = connected ? model.name : '模型';
  if (effort) effort.textContent = connected ? effortLabel(mockData.codex.effort || model.defaultReasoningEffort) : '';
  const menu = $('#external-model-menu');
  if (!menu) return;
  if (!connected) {
    menu.innerHTML = '';
    return;
  }
  const options = supportedEfforts(model);
  menu.innerHTML = `
    <div class="external-menu-section"><span>模型</span>${codexModels.map((item) => `
      <button type="button" class="external-menu-option external-model-option${item.id === model.id ? ' is-selected' : ''}" data-external-model="${escapeHtml(item.id)}" role="menuitemradio" aria-checked="${item.id === model.id}">
        <strong>${escapeHtml(item.name)}</strong>${item.id === model.id ? '<b aria-hidden="true">&#10003;</b>' : ''}
      </button>`).join('')}</div>
    ${options.length ? `<div class="external-menu-section"><span>推理强度</span>${options.map((value) => `
      <button type="button" class="external-menu-option external-model-option${(mockData.codex.effort || model.defaultReasoningEffort) === value ? ' is-selected' : ''}" data-external-effort="${escapeHtml(value)}" role="menuitemradio" aria-checked="${(mockData.codex.effort || model.defaultReasoningEffort) === value}">
        <strong>${escapeHtml(effortLabel(value))}</strong>${(mockData.codex.effort || model.defaultReasoningEffort) === value ? '<b aria-hidden="true">&#10003;</b>' : ''}
      </button>`).join('')}</div>` : ''}`;
}

function openTargetIcon(target) {
  if (target === 'vscode' || target === 'visual-studio') {
    return '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>';
  }
  if (target === 'git-bash') {
    return '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M5 7.4 6.4 6l6 6-6 6L5 16.6 9.6 12 5 7.4zM13 18h6v-2h-6v2z"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M10 4l2 2h8c1.1 0 2 .9 2 2v10c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2h6z"/></svg>';
}

function renderOpenMenu() {
  const menu = $('#external-open-menu');
  if (!menu) return;
  const targets = projectOpenTargets || [];
  menu.innerHTML = targets.map((target) => `
    <button type="button" class="external-menu-option external-open-option" data-external-open-target="${escapeHtml(target.id)}" role="menuitem">
      ${openTargetIcon(target.id)}<strong>${escapeHtml(target.label)}</strong>
    </button>`).join('');
}

async function showOpenProjectMenu() {
  if (!projectOpenTargets) {
    try {
      projectOpenTargets = await deps.invoke('external_project_open_targets');
    } catch (error) {
      window.UIDialog?.toast?.(`无法读取打开方式：${error?.message || error}`);
      return;
    }
  }
  renderOpenMenu();
  toggleExternalPopover('external-open-menu', 'external-open-project');
}

let externalRail = null;

function ensureExternalRail() {
  if (externalRail) return externalRail;
  const root = $('#external-chat-rail');
  const host = $('#external-chat-scroll');
  if (!root || !host) return null;
  externalRail = createChatRail({
    root,
    scrollHost: host,
    getMessageElement: (id) => host.querySelector(`[data-external-message-id="${CSS.escape(id)}"]`),
  });
  return externalRail;
}

function renderMessages() {
  const host = $('#external-chat-scroll');
  const found = ensureSelection();
  if (!host || !found) return;
  const { session } = found;
  if (!session.messages?.length) {
    ensureExternalRail()?.update([]);
    host.innerHTML = `
      <div class="external-chat-empty">
        <span class="external-chat-empty-brand">${icon(activeKind)}</span>
        <h2>${escapeHtml(agentMeta().label)}</h2>
        <p>在当前项目中开始一个任务。连接会在首次发送后按需启动。</p>
        <div class="external-starter-list">
          <button type="button" data-external-starter="检查当前改动并总结风险">检查当前改动</button>
          <button type="button" data-external-starter="梳理项目结构并给出下一步计划">梳理项目结构</button>
          <button type="button" data-external-starter="运行测试并修复失败项">运行测试</button>
        </div>
      </div>`;
    return;
  }

  host.innerHTML = `<div class="chat-inner external-message-stack">${session.messages.map((message) => {
    if (message.role === 'user') {
      return `
      <article class="chat-message chat-message--user external-message" data-external-message-id="${escapeHtml(message.id)}">
        ${renderMessageAttachments(message)}
        <div class="chat-message-body">${renderMessageCopy(message)}</div>
      </article>`;
    }
    const steps = (message.steps || []).map((step) => {
      const state = step.status === 'done'
        ? '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>'
        : step.status === 'failed'
          ? '<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>'
          : '<span class="mini-spinner" aria-hidden="true"></span>';
      return `
      <div class="external-tool-step">
        <span class="external-tool-state ${step.status === 'done' ? 'is-done' : step.status === 'failed' ? 'is-failed' : ''}">${state}</span>
        <span><strong>${escapeHtml(step.title)}</strong><small>${escapeHtml(step.detail)}</small></span>
      </div>`;
    }).join('');
    const approval = message.approval && !message.approval.resolved ? `
      <section class="external-approval" data-approval-message="${escapeHtml(message.id)}">
        <div class="external-approval-head"><strong>${escapeHtml(agentMeta().label)} ${message.approval.kind === 'file' ? '请求修改文件' : message.approval.kind === 'network' ? '请求访问网络' : '请求运行命令'}</strong><small>${escapeHtml(message.approval.reason || '需要你的确认后才能继续')}</small></div>
        <pre>${escapeHtml(message.approval.detail || '')}</pre>
        <div class="external-approval-actions">
          <button type="button" class="secondary-btn" data-codex-decision="decline">拒绝</button>
          ${message.approval.suppressAlways ? '' : '<button type="button" class="secondary-btn" data-codex-decision="acceptForSession">本会话允许</button>'}
          <button type="button" class="primary-btn" data-codex-decision="accept">允许一次</button>
        </div>
      </section>` : '';
    const changes = message.changes?.length ? `
      <button type="button" class="external-change-summary" data-open-review>
        <span><strong>${message.changes.length} 个文件有变更</strong><small>打开审阅查看 diff</small></span>
        <span class="external-change-counts">+${message.changes.reduce((sum, item) => sum + (Number(item.added) || 0), 0)} <i>-${message.changes.reduce((sum, item) => sum + (Number(item.removed) || 0), 0)}</i></span>
      </button>` : '';
    const pending = message.pending && !message.content
      ? '<div class="external-pending"><span class="typing-dot" aria-hidden="true"></span></div>'
      : '';
    const body = message.content
      ? `<div class="chat-message-body md">${renderMessageCopy(message)}</div>`
      : '';
    return `
      <article class="chat-message chat-message--assistant external-message" data-external-message-id="${escapeHtml(message.id)}">
        ${steps ? `<div class="external-tool-list">${steps}</div>` : ''}
        ${pending}
        ${body}
        ${approval}
        ${changes}
      </article>`;
  }).join('')}</div>`;
  prepareExternalLinks(host);
  requestAnimationFrame(() => {
    host.scrollTop = host.scrollHeight;
    ensureExternalRail()?.update(session.messages);
  });
}

function renderComposerState() {
  const send = $('#external-send');
  const input = $('#external-composer-input');
  if (!send || !input) return;
  const running = isLiveKind() ? !!findSession()?.session?.running : !!currentAgentState().running;
  const hasSession = !!findSession();
  const hasDraft = !!input.value.trim() || !!composerAttachments.length;
  input.disabled = !hasSession;
  send.disabled = !hasSession || (!running && !hasDraft);
  send.classList.toggle('is-stop', running);
  send.classList.toggle('is-ready', running || (hasSession && hasDraft));
  send.title = running ? '停止' : '发送';
  send.setAttribute('aria-label', running ? '停止' : '发送');
  send.innerHTML = running
    ? '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6 6h12v12H6z"/></svg>'
    : '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/></svg>';
  renderComposerAttachments();
  renderPermissionMenu();
  renderModelMenu();
}

function renderRuntimeState() {
  const host = $('#external-runtime-state');
  if (!host) return;
  let status = 'mock';
  if (activeKind === 'codex') {
    status = findSession()?.session?.running ? 'working' : (mockData.codex.connectionStatus || 'disconnected');
  } else if (activeKind === 'claude') {
    const session = findSession()?.session;
    status = session?.running
      ? 'working'
      : session?.starting
        ? 'connecting'
        : session && claudeAliveKeys.has(session.id)
          ? 'connected'
          : mockData.claude.connectionStatus === 'error' ? 'error' : 'disconnected';
  }
  const labels = {
    connected: '已连接',
    working: '工作中',
    connecting: '连接中',
    error: '连接异常',
    disconnected: '未连接',
    mock: 'UI mock',
  };
  host.className = `external-runtime-state is-${status}`;
  host.textContent = labels[status] || labels.disconnected;
}

function renderAgentWorkspace() {
  const meta = agentMeta();
  const agentState = currentAgentState();
  const found = ensureSelection();
  const listBrand = $('#external-list-brand');
  if (listBrand) listBrand.innerHTML = icon(activeKind);
  if ($('#external-list-title')) $('#external-list-title').textContent = meta.label;
  renderRuntimeState();
  renderProjectTree();

  if (!found) {
    if ($('#external-main-session-title')) $('#external-main-session-title').textContent = '尚未添加项目';
    ensureExternalRail()?.update([]);
    const chat = $('#external-chat-scroll');
    if (chat) {
      chat.innerHTML = `
        <div class="external-chat-empty">
          <span class="external-chat-empty-brand">${icon(activeKind)}</span>
          <h2>添加第一个项目</h2>
          <p>${escapeHtml(meta.label)} 会将会话归属到具体项目，并以项目目录作为文件与终端范围。</p>
          <div class="external-starter-list"><button type="button" data-empty-add-project>添加项目目录</button></div>
        </div>`;
      chat.querySelector('[data-empty-add-project]')?.addEventListener('click', addProject);
    }
    renderComposerState();
    renderRightWorkspace();
    return;
  }
  const { session } = found;

  if ($('#external-main-session-title')) $('#external-main-session-title').textContent = session.title;
  const context = activeKind === 'claude'
    ? Math.max(0, Math.min(100, Number(session.contextPct) || 0))
    : Math.max(0, Math.min(100, Number(agentState.context) || 0));
  const meter = $('#external-context-meter');
  if (meter) {
    meter.hidden = activeKind === 'codex'
      ? !agentState.contextKnown
      : activeKind === 'claude' ? !session.contextKnown : true;
    meter.title = activeKind === 'claude' && session.costUsd
      ? `上下文用量 · 本会话累计 $${Number(session.costUsd).toFixed(4)}`
      : '上下文用量';
  }
  meter?.style.setProperty('--external-context', context);
  if ($('#external-context-label')) $('#external-context-label').textContent = `${context}%`;
  renderMessages();
  renderComposerState();
  renderRightWorkspace();
}

function mockReviews() {
  return [
    {
      path: 'ui/js/external-agent-mode.js', added: 186, removed: 24,
      lines: [
        { type: 'ctx', text: 'export function initExternalAgentMode(options) {' },
        { type: 'del', text: '-  renderSettings();' },
        { type: 'add', text: '+  bindWorkspaceEvents();' },
        { type: 'add', text: '+  syncNavigation();' },
        { type: 'ctx', text: '}' },
      ],
    },
    {
      path: 'ui/css/app.css', added: 142, removed: 0,
      lines: [
        { type: 'ctx', text: '/* External agent workspace */' },
        { type: 'add', text: '+.external-agent-view {' },
        { type: 'add', text: '+  min-width: 0;' },
        { type: 'add', text: '+  background: var(--bg);' },
        { type: 'add', text: '+}' },
      ],
    },
  ];
}

function projectChildPath(root, name) {
  const separator = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${separator}${name}`;
}

function projectRelativePath(root, path) {
  const normalizedRoot = String(root || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedPath = String(path || '').replace(/\\/g, '/');
  const rootKey = normalizedRoot.toLowerCase();
  const pathKey = normalizedPath.toLowerCase();
  if (pathKey === rootKey) return '';
  return pathKey.startsWith(`${rootKey}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}

function entryName(entry) {
  const value = String(entry?.fileName || entry?.name || entry?.path || '');
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

function decodeBase64Text(value) {
  const binary = atob(String(value || ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function loadCodexFiles(project, directory) {
  if (!project) return;
  const state = codexFileCache.get(project.path) || { directories: new Map(), expanded: new Set([project.path]) };
  codexFileCache.set(project.path, state);
  const targetPath = directory || project.path;
  const cached = state.directories.get(targetPath);
  if (cached?.loading || cached?.loaded) return;
  const folder = { loading: true, loaded: false, entries: [], error: '' };
  state.directories.set(targetPath, folder);
  try {
    const entries = await deps.invoke('external_project_list', {
      root: project.path,
      relativePath: projectRelativePath(project.path, targetPath),
    });
    folder.entries = (entries || [])
      .map((entry) => {
        const rawPath = String(entry?.path || entry?.name || '');
        const fullPath = projectChildPath(project.path, rawPath);
        return {
          name: entryName(entry),
          path: projectRelativePath(project.path, fullPath),
          fullPath,
          isDirectory: !!entry?.isDirectory,
          status: '',
          content: null,
        };
      })
      .filter((entry) => entry.name)
      .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
    folder.loaded = true;
  } catch (error) {
    folder.error = error?.message || String(error);
  } finally {
    folder.loading = false;
    if (activeWorkspaceTab === 'files') renderRightWorkspace();
  }
}

async function loadCodexFile(project, fullPath) {
  const state = codexFileCache.get(project.path);
  const file = [...(state?.directories?.values() || [])]
    .flatMap((folder) => folder.entries || [])
    .find((entry) => entry.fullPath === fullPath);
  if (!file || file.loading || file.content !== null) return;
  if (/\.(?:png|jpe?g|gif|webp|ico|pdf|zip|7z|rar|exe|dll|pdb|woff2?|ttf|mp[34]|mov|avi)$/i.test(file.name)) {
    file.content = '二进制文件不提供文本预览。';
    renderRightWorkspace();
    return;
  }
  file.loading = true;
  try {
    const result = await deps.invoke('external_project_read', {
      root: project.path,
      relativePath: file.path,
    });
    const encoded = String(result?.dataBase64 || '');
    file.content = encoded.length > 2_800_000 ? '文件超过 2 MB，不在侧栏中预览。' : decodeBase64Text(encoded);
  } catch (error) {
    file.content = `无法读取文件：${error?.message || error}`;
  } finally {
    file.loading = false;
    if (activeWorkspaceTab === 'files') renderRightWorkspace();
  }
}

function cachedProjectFiles(state) {
  return [...(state?.directories?.values() || [])].flatMap((folder) => folder.entries || []);
}

function renderProjectFileTree(project, state, directory, depth, changedPaths, selectedPath) {
  const folder = state?.directories?.get(directory);
  if (!folder) return '';
  if (folder.loading) return `<div class="external-tree-loading" style="padding-left:${12 + depth * 14}px">读取中…</div>`;
  if (folder.error) return `<div class="external-tree-loading is-error" style="padding-left:${12 + depth * 14}px">无法读取目录</div>`;
  return (folder.entries || []).map((item) => {
    const expanded = item.isDirectory && state.expanded.has(item.fullPath);
    const active = !item.isDirectory && item.fullPath === selectedPath;
    const control = item.isDirectory
      ? `data-external-directory="${escapeHtml(item.fullPath)}" aria-expanded="${expanded}"`
      : `data-external-file="${escapeHtml(item.fullPath)}"`;
    const marker = item.isDirectory ? (expanded ? '&#9662;' : '&#9656;') : escapeHtml(item.status || (changedPaths.has(item.path) ? 'M' : ''));
    return `
      <button type="button" class="${item.isDirectory ? 'is-directory' : ''} ${active ? 'is-active' : ''}" ${control} style="padding-left:${7 + depth * 14}px">
        <span class="external-file-status">${marker}</span><span>${escapeHtml(item.name || item.path)}</span>
      </button>
      ${expanded ? renderProjectFileTree(project, state, item.fullPath, depth + 1, changedPaths, selectedPath) : ''}`;
  }).join('');
}

const WORKSPACE_TAB_KINDS = [
  {
    kind: 'terminal',
    label: '终端',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M5 7.4 6.4 6l6 6-6 6L5 16.6 9.6 12 5 7.4zM13 18h6v-2h-6v2z"/></svg>',
  },
  {
    kind: 'files',
    label: '文件',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/></svg>',
  },
  {
    kind: 'review',
    label: '审阅',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>',
  },
];

function workspaceTabMeta(kind) {
  return WORKSPACE_TAB_KINDS.find((item) => item.kind === kind) || null;
}

function chatTabAddWrap() {
  return document.querySelector('.rp-tab-add-wrap:not(.external-tab-add-wrap)');
}

function closeExternalTabAddMenu() {
  const menu = $('#external-tab-add-menu');
  if (menu) menu.hidden = true;
  $('#external-tab-add')?.setAttribute('aria-expanded', 'false');
}

function renderExternalTabAddMenu() {
  const menu = $('#external-tab-add-menu');
  if (!menu) return;
  menu.innerHTML = WORKSPACE_TAB_KINDS.map((tab) => `
    <button type="button" class="rp-add-item" role="menuitem" data-external-workspace-open="${tab.kind}">
      ${tab.icon}${tab.label}
    </button>`).join('');
}

function openWorkspaceTab(kind) {
  if (!workspaceTabMeta(kind)) return;
  if (!workspaceTabs.includes(kind)) workspaceTabs.push(kind);
  activeWorkspaceTab = kind;
  closeExternalTabAddMenu();
  renderRightWorkspace();
}

function closeWorkspaceTab(kind) {
  workspaceTabs = workspaceTabs.filter((item) => item !== kind);
  if (activeWorkspaceTab === kind) {
    activeWorkspaceTab = workspaceTabs[workspaceTabs.length - 1] || '';
  }
  if (kind === 'terminal') stopPowerShell();
  renderRightWorkspace();
}

/** 关闭终端标签 = 结束 PowerShell 进程；下次打开标签时重新启动。 */
function stopPowerShell() {
  disposeXterm();
  powerShellBuffers.clear();
  deps.invoke('powershell_terminal_close', {}).catch(() => {});
}

function renderWorkspaceHome() {
  return `
    <div class="rp-home-spacer"></div>
    <nav class="rp-tools" aria-label="打开工作区标签">
      ${WORKSPACE_TAB_KINDS.map((tab) => `
        <button type="button" class="rp-tool" data-external-workspace-open="${tab.kind}">
          <span class="rp-tool-left">${tab.icon}${tab.label}</span>
        </button>`).join('')}
    </nav>
    <p class="rp-home-note">点上方 + 或入口，将终端 / 文件 / 审阅加入标签页。终端在打开标签时启动 PowerShell，关闭标签即结束进程。</p>`;
}

function renderRightWorkspace() {
  const appState = deps?.getState?.();
  if (!appState?.rightOpen || !isAgentMode(appState.mode)) return;
  const pane = $('#right-pane');
  const tabs = $('#right-tabs');
  const home = $('#rp-home');
  const content = $('#rp-content');
  const externalAddWrap = $('#external-tab-add-wrap');
  const chatAddWrap = chatTabAddWrap();
  if (!pane || !tabs || !content) return;
  pane.classList.add('is-external-workspace');
  pane.dataset.view = activeWorkspaceTab ? `external-${activeWorkspaceTab}` : 'external-home';
  if (home) home.hidden = true;
  if (chatAddWrap) chatAddWrap.hidden = true;
  if (externalAddWrap) externalAddWrap.hidden = false;
  renderExternalTabAddMenu();

  const selectedSession = findSession()?.session;
  const reviewCount = isLiveKind() ? changesFromDiff(selectedSession?.realDiff).length : 2;
  tabs.innerHTML = workspaceTabs.map((kind) => {
    const meta = workspaceTabMeta(kind);
    const count = kind === 'review' && reviewCount
      ? `<b class="external-tab-count">${reviewCount}</b>`
      : '';
    return `
    <button type="button" class="rp-tab external-workspace-tab${activeWorkspaceTab === kind ? ' is-active' : ''}" data-external-workspace-tab="${kind}" role="tab" aria-selected="${activeWorkspaceTab === kind}">
      <span class="rp-tab-label">${meta.label}${count}</span>
      <span class="rp-tab-close" title="关闭">×</span>
    </button>`;
  }).join('');

  content.hidden = false;
  content.innerHTML = activeWorkspaceTab
    ? renderWorkspaceContent(activeWorkspaceTab)
    : renderWorkspaceHome();
  bindWorkspaceContent();
  if (activeWorkspaceTab === 'terminal') {
    requestAnimationFrame(() => mountXterm(ensureSelection()?.project));
  } else disposeXterm();
  if (activeWorkspaceTab === 'files') loadCodexFiles(ensureSelection()?.project);
}

function renderWorkspaceContent(tab) {
  const found = ensureSelection();
  if (!found) return '<div class="rp-empty"><p class="rp-empty-title">尚未选择项目</p><p class="rp-empty-desc">添加项目后显示工作区内容</p></div>';
  const { project, session } = found;
  if (tab === 'terminal') {
    return `
      <section class="external-terminal" aria-label="终端预览">
        <div id="external-xterm" class="external-xterm" aria-label="Windows PowerShell 终端"></div>
      </section>`;
  }
  if (tab === 'files') {
    const cached = codexFileCache.get(project.path);
    const rootFolder = cached?.directories?.get(project.path);
    if (!cached || !rootFolder || rootFolder.loading) {
      return '<div class="rp-empty"><p class="rp-empty-title">正在读取文件</p><p class="rp-empty-desc">正在读取项目根目录</p></div>';
    }
    if (rootFolder.error) {
      return `<div class="rp-empty"><p class="rp-empty-title">无法读取项目文件</p><p class="rp-empty-desc">${escapeHtml(rootFolder.error)}</p></div>`;
    }
    const files = cachedProjectFiles(cached);
    const fileEntries = files.filter((item) => !item.isDirectory);
    const selected = currentAgentState().selectedFile || fileEntries[0]?.fullPath || fileEntries[0]?.path;
    const file = fileEntries.find((item) => (item.fullPath || item.path) === selected) || fileEntries[0];
    const changedPaths = new Set(session.messages?.flatMap((message) => message.changes || []).map((change) => change.path));
    return `
      <section class="external-files" aria-label="项目文件">
        <header class="external-workspace-subhead"><span title="${escapeHtml(project.path)}">${escapeHtml(project.name)}</span><span class="external-workspace-actions"><button type="button" data-external-files-refresh title="刷新" aria-label="刷新文件"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M17.65 6.35A7.96 7.96 0 0 0 12 4c-4.42 0-7.99 3.58-8 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg></button></span></header>
        <div class="external-file-tree">${renderProjectFileTree(project, cached, project.path, 0, changedPaths, file?.fullPath) || '<div class="external-tree-empty">项目目录为空</div>'}</div>
        <div class="external-file-preview">
          <div class="external-file-preview-head"><span>${escapeHtml(file?.path || '选择文件')}</span><small>只读</small></div>
          <pre>${file ? (file.loading ? '读取中…' : escapeHtml(file.content ?? (activeKind === 'codex' ? '选择文件后读取内容' : ''))) : '选择文件后查看内容'}</pre>
        </div>
      </section>`;
  }
  const reviews = isLiveKind()
    ? (session.realDiff ? changesFromDiff(session.realDiff).map((item) => ({
      ...item,
      lines: item.diff.split(/\r?\n/).map((text) => ({ type: text.startsWith('+') && !text.startsWith('+++') ? 'add' : text.startsWith('-') && !text.startsWith('---') ? 'del' : 'ctx', text })),
    })) : [])
    : mockReviews();
  if (!reviews.length) return `<div class="rp-empty"><p class="rp-empty-title">暂无文件变更</p><p class="rp-empty-desc">${escapeHtml(agentMeta().label)} 修改文件后会在这里显示本次会话的 diff</p></div>`;
  const selected = currentAgentState().selectedReview || reviews[0].path;
  const review = reviews.find((item) => item.path === selected) || reviews[0];
  const totals = reviews.reduce((sum, item) => ({ added: sum.added + item.added, removed: sum.removed + item.removed }), { added: 0, removed: 0 });
  return `
    <section class="external-review" aria-label="变更审阅">
      <header class="external-review-summary"><span><strong>${reviews.length} 个文件</strong><small>${escapeHtml(session.title)}</small></span><span class="external-review-totals">+${totals.added} <i>-${totals.removed}</i></span></header>
      <div class="external-review-files">${reviews.map((item) => `
        <button type="button" class="${item.path === review.path ? 'is-active' : ''}" data-external-review="${escapeHtml(item.path)}">
          <span>${escapeHtml(item.path)}</span><small>+${item.added} <i>-${item.removed}</i></small>
        </button>`).join('')}</div>
      <div class="external-diff">
        <div class="external-file-preview-head"><span>${escapeHtml(review.path)}</span><small>${isLiveKind() && session.realDiff ? (activeKind === 'claude' ? '工具调用汇总' : 'Codex diff') : 'mock diff'}</small></div>
        <pre>${review.lines.map((line, index) => `<span class="diff-${line.type}"><b>${index + 1}</b>${escapeHtml(line.text)}</span>`).join('')}</pre>
      </div>
    </section>`;
}

function bindWorkspaceContent() {
  $all('[data-external-workspace-tab]').forEach((button) => {
    button.addEventListener('click', (event) => {
      const kind = button.dataset.externalWorkspaceTab;
      if (event.target.closest('.rp-tab-close')) {
        event.stopPropagation();
        closeWorkspaceTab(kind);
        return;
      }
      activeWorkspaceTab = kind;
      renderRightWorkspace();
    });
  });
  $all('[data-external-workspace-open]').forEach((button) => {
    button.addEventListener('click', () => openWorkspaceTab(button.dataset.externalWorkspaceOpen));
  });
  $all('[data-external-file]').forEach((button) => {
    button.addEventListener('click', () => {
      currentAgentState().selectedFile = button.dataset.externalFile;
      renderRightWorkspace();
      const found = ensureSelection();
      if (found) loadCodexFile(found.project, button.dataset.externalFile);
    });
  });
  $all('[data-external-directory]').forEach((button) => {
    button.addEventListener('click', () => {
      const found = ensureSelection();
      if (!found) return;
      const state = codexFileCache.get(found.project.path);
      if (!state) return;
      const directory = button.dataset.externalDirectory;
      if (state.expanded.has(directory)) state.expanded.delete(directory);
      else state.expanded.add(directory);
      if (state.expanded.has(directory)) loadCodexFiles(found.project, directory);
      renderRightWorkspace();
    });
  });
  $('[data-external-files-refresh]')?.addEventListener('click', () => {
    const project = ensureSelection()?.project;
    if (project) {
      codexFileCache.delete(project.path);
      renderRightWorkspace();
    }
  });
  $all('[data-external-review]').forEach((button) => {
    button.addEventListener('click', () => {
      currentAgentState().selectedReview = button.dataset.externalReview;
      renderRightWorkspace();
    });
  });
}

async function addProject() {
  const path = await window.UIDialog?.prompt?.('添加项目', '', '输入项目目录，例如 E:\\workspace\\my-app');
  if (!path?.trim()) return;
  const normalized = path.trim().replace(/[\\/]+$/, '');
  const name = normalized.split(/[\\/]/).filter(Boolean).pop() || '未命名项目';
  const project = { id: uid(`${activeKind}_project`), name, path: normalized, open: true, sessions: [] };
  const session = createSession('新会话');
  project.sessions.push(session);
  currentAgentState().projects.unshift(project);
  currentAgentState().selectedSessionId = session.id;
  persistMockData();
  renderAgentWorkspace();
}

async function handleTreeAction(event) {
  const button = event.target.closest('[data-external-action]');
  if (!button) return;
  const group = button.closest('[data-project-id]');
  const project = currentAgentState().projects.find((item) => item.id === group?.dataset.projectId);
  if (!project) return;
  const sessionRow = button.closest('[data-session-id]');
  const session = project.sessions.find((item) => item.id === sessionRow?.dataset.sessionId);
  const action = button.dataset.externalAction;
  if (action === 'toggle-project') project.open = !project.open;
  if (action === 'open-session' && session) currentAgentState().selectedSessionId = session.id;
  if (action === 'new-session') {
    const title = await window.UIDialog?.prompt?.('新建会话', '新会话', '会话名称');
    if (title == null) return;
    const next = createSession(title);
    project.sessions.unshift(next);
    project.open = true;
    currentAgentState().selectedSessionId = next.id;
  }
  if (action === 'rename-session' && session) {
    const title = await window.UIDialog?.prompt?.('重命名会话', session.title, '会话名称');
    if (!title?.trim()) return;
    session.title = title.trim();
    if (activeKind === 'codex' && session.threadId) {
      deps.invoke('codex_request', {
        method: 'thread/name/set',
        params: { threadId: session.threadId, name: session.title },
      }).catch((error) => window.UIDialog?.toast?.(`Codex 会话重命名失败：${error?.message || error}`));
    }
    if (activeKind === 'claude' && claudeAliveKeys.has(session.id)) {
      claudeControl(session.id, 'rename_session', { title: session.title })
        .catch((error) => window.UIDialog?.toast?.(`Claude Code 会话重命名失败：${error?.message || error}`));
    }
  }
  if (action === 'delete-session' && session) {
    if (session.running) {
      window.UIDialog?.toast?.('请先停止正在运行的任务');
      return;
    }
    const ok = await window.UIDialog?.confirm?.(`删除会话「${session.title}」？`, '删除会话', { danger: true, okText: '删除' });
    if (!ok) return;
    if (activeKind === 'codex' && session.threadId) {
      try {
        await deps.invoke('codex_request', { method: 'thread/archive', params: { threadId: session.threadId } });
      } catch (error) {
        window.UIDialog?.toast?.(`Codex 会话归档失败：${error?.message || error}`);
        return;
      }
    }
    if (activeKind === 'claude') {
      // 只移除 WePChat 索引，不删 ~/.claude/projects 下的转录文件。
      await deps.invoke('claude_stop', { sessionKey: session.id }).catch(() => {});
      claudeAliveKeys.delete(session.id);
    }
    project.sessions = project.sessions.filter((item) => item.id !== session.id);
  }
  if (action === 'remove-project') {
    const ok = await window.UIDialog?.confirm?.(`从列表移除项目「${project.name}」？不会删除磁盘文件。`, '移除项目', { danger: true, okText: '移除' });
    if (!ok) return;
    currentAgentState().projects = currentAgentState().projects.filter((item) => item.id !== project.id);
  }
  ensureSelection();
  persistMockData();
  renderAgentWorkspace();
}

function codexAssistantMessage(session, turnId = session.activeTurnId) {
  return [...(session.messages || [])].reverse().find((message) => (
    message.role === 'assistant' && (!turnId || message.turnId === turnId || message.pending)
  ));
}

function ensureCodexAssistant(session, turnId) {
  let message = codexAssistantMessage(session, turnId);
  if (!message) {
    message = { id: uid('eam'), role: 'assistant', content: '', time: nowLabel(), turnId, pending: true, steps: [] };
    session.messages ||= [];
    session.messages.push(message);
  }
  if (turnId) message.turnId = turnId;
  return message;
}

function diffStats(diff = '') {
  let added = 0;
  let removed = 0;
  String(diff).split(/\r?\n/).forEach((line) => {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  });
  return { added, removed };
}

function changesFromDiff(diff = '') {
  const chunks = String(diff).split(/(?=^diff --git )/m).filter(Boolean);
  return chunks.map((chunk, index) => {
    const match = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m) || chunk.match(/^\+\+\+\s+(?:b\/)?(.+)$/m);
    return { path: match?.[2] || match?.[1] || `change-${index + 1}`, ...diffStats(chunk), diff: chunk };
  });
}

function codexToolStep(item = {}) {
  const labels = {
    commandExecution: '运行命令',
    fileChange: '修改文件',
    mcpToolCall: '调用 MCP 工具',
    dynamicToolCall: '调用工具',
    webSearch: '搜索网页',
  };
  return {
    id: item.id,
    title: labels[item.type] || item.type || '执行工具',
    detail: item.command || item.tool || item.server || item.cwd || '',
    status: 'running',
  };
}

function updateCodexView(found) {
  persistMockData();
  if (activeKind === 'codex' && found?.session?.id === currentAgentState().selectedSessionId) {
    renderAgentWorkspace();
  }
}

function clearCodexRuntime(markDisconnected = false) {
  mockData.codex.running = false;
  mockData.codex.projects.flatMap((project) => project.sessions).forEach((session) => {
    if (markDisconnected && session.running) {
      const assistant = codexAssistantMessage(session, session.activeTurnId);
      if (assistant) {
        assistant.pending = false;
        assistant.content ||= 'Codex 连接已断开，请重新发送任务。';
      }
    }
    session.running = false;
    session.activeTurnId = '';
  });
}

function handleCodexServerRequest(message) {
  const { method, params = {}, id } = message || {};
  if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method)) return;
  const found = findCodexSession(params.threadId);
  if (!found) return;
  const assistant = ensureCodexAssistant(found.session, params.turnId);
  const network = params.networkApprovalContext;
  assistant.approval = {
    requestId: id,
    kind: method.includes('fileChange') ? 'file' : network ? 'network' : 'command',
    reason: params.reason || '',
    detail: network
      ? `${network.protocol || 'network'}://${network.host || ''}`
      : params.command || params.grantRoot || '文件变更',
    resolved: false,
  };
  updateCodexView(found);
}

function handleCodexNotification(message) {
  const { method, params = {} } = message || {};
  const found = findCodexSession(params.threadId);
  if (!found) return;
  const { session } = found;
  const turnId = params.turnId || params.turn?.id || session.activeTurnId;
  const assistant = ensureCodexAssistant(session, turnId);

  if (method === 'turn/started') {
    session.activeTurnId = turnId;
    assistant.turnId = turnId;
    session.running = true;
    mockData.codex.running = true;
  } else if (method === 'item/agentMessage/delta') {
    assistant.content += params.delta || '';
    assistant.pending = false;
  } else if (method === 'item/started') {
    const item = params.item || {};
    if (item.type && item.type !== 'agentMessage' && item.type !== 'reasoning') {
      assistant.steps ||= [];
      if (!assistant.steps.some((step) => step.id === item.id)) assistant.steps.push(codexToolStep(item));
    }
    if (item.type === 'commandExecution' && item.command) {
      session.terminalLines ||= [];
      if (!session.terminalLines.some((line) => line.itemId === item.id && line.kind === 'command')) {
        session.terminalLines.push({ itemId: item.id, kind: 'command', text: item.command });
      }
    }
  } else if (method === 'item/commandExecution/outputDelta') {
    session.terminalLines ||= [];
    const last = session.terminalLines.at(-1);
    if (last?.itemId === params.itemId) last.text += params.delta || '';
    else session.terminalLines.push({ itemId: params.itemId, kind: 'output', text: params.delta || '' });
  } else if (method === 'item/completed') {
    const item = params.item || {};
    const step = assistant.steps?.find((entry) => entry.id === item.id);
    if (step) {
      step.status = ['failed', 'declined'].includes(item.status) ? 'failed' : 'done';
      step.detail = item.command || item.tool || item.aggregatedOutput || step.detail;
    }
    if (item.type === 'commandExecution' && item.aggregatedOutput) {
      session.terminalLines ||= [];
      if (!session.terminalLines.some((line) => line.itemId === item.id && line.kind === 'output')) {
        session.terminalLines.push({ itemId: item.id, kind: 'output', text: item.aggregatedOutput });
      }
    }
    if (item.type === 'agentMessage' && !assistant.content && item.text) assistant.content = item.text;
    if (item.type === 'fileChange' && item.changes?.length) {
      assistant.changes = item.changes.map((change) => ({ path: change.path, ...diffStats(change.diff), diff: change.diff }));
      session.realDiff = item.changes.map((change) => change.diff).filter(Boolean).join('\n');
    }
  } else if (method === 'turn/plan/updated') {
    assistant.steps = (params.plan || []).map((step, index) => ({ id: `plan-${index}`, title: step.step, detail: '', status: step.status === 'completed' ? 'done' : 'running' }));
  } else if (method === 'turn/diff/updated') {
    session.realDiff = params.diff || '';
    assistant.changes = changesFromDiff(session.realDiff);
  } else if (method === 'thread/tokenUsage/updated') {
    const total = Number(params.tokenUsage?.total?.totalTokens) || 0;
    const windowSize = Number(params.tokenUsage?.modelContextWindow) || 0;
    if (windowSize) {
      mockData.codex.context = Math.min(100, Math.round((total / windowSize) * 100));
      mockData.codex.contextKnown = true;
    }
  } else if (method === 'error') {
    assistant.content ||= `Codex 错误：${params.error?.message || '任务执行失败'}`;
    assistant.pending = false;
  } else if (method === 'turn/completed') {
    assistant.pending = false;
    assistant.content ||= params.turn?.error?.message ? `Codex 错误：${params.turn.error.message}` : 'Codex 已完成本次任务。';
    session.running = false;
    session.activeTurnId = '';
    mockData.codex.running = false;
  }
  updateCodexView(found);
}

function handleCodexEvent(payload = {}) {
  if (payload.kind === 'status') {
    mockData.codex.connectionStatus = payload.status === 'connected' ? 'connected' : 'disconnected';
    if (payload.status !== 'connected') {
      codexReadyPromise = null;
      codexReadyThreads.clear();
      clearCodexRuntime(true);
    }
    persistMockData();
    if (activeKind === 'codex') renderAgentWorkspace();
    return;
  }
  if (payload.kind === 'diagnostic') {
    mockData.codex.terminalLines ||= [];
    mockData.codex.terminalLines.push({ kind: payload.level === 'error' ? 'error' : 'output', text: payload.text || '' });
    if (mockData.codex.terminalLines.length > 120) mockData.codex.terminalLines.splice(0, mockData.codex.terminalLines.length - 120);
    if (activeKind === 'codex' && activeWorkspaceTab === 'terminal') renderRightWorkspace();
    return;
  }
  if (payload.kind === 'serverRequest') handleCodexServerRequest(payload.message);
  if (payload.kind === 'notification') handleCodexNotification(payload.message);
}

async function ensureCodexConnection() {
  if (codexReadyPromise) return codexReadyPromise;
  mockData.codex.connectionStatus = 'connecting';
  renderRuntimeState();
  codexReadyPromise = deps.invoke('codex_request', { method: 'model/list', params: { includeHidden: false } })
    .then((result) => {
      codexModels = (result?.data || []).filter((item) => !item.hidden).map((item) => ({
        id: item.id || item.model,
        name: item.displayName || item.id || item.model,
        isDefault: !!item.isDefault,
        defaultReasoningEffort: item.defaultReasoningEffort || '',
        supportedReasoningEfforts: item.supportedReasoningEfforts || [],
      })).filter((item) => item.id);
      mockData.codex.connectionStatus = 'connected';
      if (codexModels.length && !codexModels.some((item) => item.id === mockData.codex.model)) {
        mockData.codex.model = codexModels.find((item) => item.isDefault)?.id || codexModels[0].id;
      }
      const model = selectedCodexModel();
      if (model && !supportedEfforts(model).includes(mockData.codex.effort)) {
        mockData.codex.effort = model.defaultReasoningEffort || '';
      }
      persistMockData();
      if (activeKind === 'codex') renderAgentWorkspace();
      return result;
    })
    .catch((error) => {
      codexReadyPromise = null;
      mockData.codex.connectionStatus = 'error';
      renderRuntimeState();
      throw error;
    });
  return codexReadyPromise;
}

function codexRunOptions(project, agentState) {
  const permission = permissionProfile();
  return {
    cwd: project.path,
    model: agentState.model,
    approvalPolicy: permission.approvalPolicy,
    sandbox: permission.sandbox,
  };
}

async function stopCodexTurn() {
  const found = ensureSelection();
  const turnId = found?.session?.activeTurnId;
  if (!found?.session?.threadId || !turnId) return;
  try {
    await deps.invoke('codex_request', {
      method: 'turn/interrupt',
      params: { threadId: found.session.threadId, turnId },
    });
  } catch (error) {
    window.UIDialog?.toast?.(`停止失败：${error?.message || error}`);
  }
}

async function sendCodexMessage() {
  const input = $('#external-composer-input');
  const agentState = mockData.codex;
  const selected = ensureSelection();
  if (selected?.session?.running) {
    await stopCodexTurn();
    return;
  }
  const content = input?.value.trim();
  if (!content && !composerAttachments.length) return;
  const found = selected;
  if (!found) return;
  const { project, session } = found;
  session.messages ||= [];
  const attachments = composerAttachments;
  session.messages.push({ id: uid('eam'), role: 'user', content, attachments, time: nowLabel() });
  const assistant = { id: uid('eam'), role: 'assistant', content: '', time: nowLabel(), pending: true, steps: [] };
  session.messages.push(assistant);
  session.updated = '刚刚';
  input.value = '';
  input.style.height = '';
  composerAttachments = [];
  agentState.running = true;
  session.running = true;
  renderMessages();
  renderComposerState();
  renderRuntimeState();

  try {
    await ensureCodexConnection();
    const options = codexRunOptions(project, agentState);
    if (!session.threadId) {
      const started = await deps.invoke('codex_request', { method: 'thread/start', params: options });
      session.threadId = started?.thread?.id || started?.threadId;
      if (!session.threadId) throw new Error('thread/start 未返回 thread id');
      codexReadyThreads.add(session.threadId);
      if (!session.title || session.title === '新会话') session.title = (content || attachments[0]?.name || '新会话').slice(0, 28);
      deps.invoke('codex_request', {
        method: 'thread/name/set',
        params: { threadId: session.threadId, name: session.title },
      }).catch(() => {});
    } else if (!codexReadyThreads.has(session.threadId)) {
      await deps.invoke('codex_request', {
        method: 'thread/resume',
        params: { threadId: session.threadId, ...options },
      });
      codexReadyThreads.add(session.threadId);
    }
    const permission = permissionProfile();
    const turnInput = [
      ...(content ? [{ type: 'text', text: content }] : []),
      ...attachments.map((attachment) => ({ type: 'image', url: attachment.url })),
    ];
    const started = await deps.invoke('codex_request', {
      method: 'turn/start',
      params: {
        threadId: session.threadId,
        input: turnInput,
        cwd: project.path,
        model: agentState.model,
        effort: agentState.effort || undefined,
        approvalPolicy: permission.approvalPolicy,
        sandboxPolicy: permission.sandboxPolicy(project),
      },
    });
    const turnId = started?.turn?.id || started?.turnId;
    if (!turnId) throw new Error('turn/start 未返回 turn id');
    assistant.turnId = turnId;
    session.activeTurnId = turnId;
    persistMockData();
    renderAgentWorkspace();
  } catch (error) {
    assistant.pending = false;
    assistant.content = `无法启动 Codex：${error?.message || error}`;
    agentState.running = false;
    session.running = false;
    persistMockData();
    renderAgentWorkspace();
  }
}

async function respondCodexApproval(messageId, decision) {
  const found = ensureSelection();
  const message = found?.session?.messages?.find((item) => item.id === messageId);
  if (!message?.approval || message.approval.resolved) return;
  try {
    await deps.invoke('codex_respond', {
      requestId: message.approval.requestId,
      result: { decision },
    });
    message.approval.resolved = true;
    message.approval.decision = decision;
    updateCodexView(found);
  } catch (error) {
    window.UIDialog?.toast?.(`审批响应失败：${error?.message || error}`);
  }
}

function sendMessage() {
  if (activeKind === 'codex') return sendCodexMessage();
  if (activeKind === 'claude') return sendClaudeMessage();
  return sendMockMessage();
}

/* ---------- Claude Code（stream-json，每会话一个进程） ---------- */

const CLAUDE_TOOL_LABELS = {
  Bash: '运行命令',
  Edit: '修改文件',
  Write: '修改文件',
  MultiEdit: '修改文件',
  NotebookEdit: '修改文件',
  Read: '读取文件',
  Glob: '检索文件',
  Grep: '检索内容',
  Task: '子代理',
  WebFetch: '访问网络',
  WebSearch: '搜索网页',
  TodoWrite: '更新计划',
};

function stripAnsi(value) {
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function claudeControl(sessionKey, subtype, params = {}) {
  return deps.invoke('claude_control', { sessionKey, subtype, params });
}

function findClaudeSessionByKey(sessionKey) {
  for (const project of mockData.claude.projects) {
    const session = project.sessions.find((item) => item.id === sessionKey);
    if (session) return { project, session };
  }
  return null;
}

function claudeAssistantMessage(session) {
  return [...(session.messages || [])].reverse().find((message) => message.role === 'assistant');
}

function ensureClaudeAssistant(session) {
  const last = claudeAssistantMessage(session);
  if (last && (last.pending || session.running)) return last;
  const created = { id: uid('eam'), role: 'assistant', content: '', time: nowLabel(), pending: true, steps: [] };
  (session.messages ||= []).push(created);
  return created;
}

function updateClaudeView(found, immediate = false) {
  const render = () => {
    claudeRenderTimer = 0;
    persistMockData();
    if (activeKind === 'claude' && found?.session?.id === mockData.claude.selectedSessionId) {
      renderAgentWorkspace();
    }
  };
  if (immediate) {
    clearTimeout(claudeRenderTimer);
    render();
    return;
  }
  // 流式增量按 40ms 合并渲染，避免逐 token 全量重绘。
  if (!claudeRenderTimer) claudeRenderTimer = window.setTimeout(render, 40);
}

function clearClaudeRuntime(markDisconnected = false) {
  mockData.claude.running = false;
  mockData.claude.projects.flatMap((project) => project.sessions).forEach((session) => {
    if (markDisconnected && session.running) {
      const assistant = claudeAssistantMessage(session);
      if (assistant) {
        assistant.pending = false;
        assistant.content ||= 'Claude Code 连接已断开，请重新发送任务。';
      }
    }
    session.running = false;
    delete session.starting;
  });
}

function claudeToolStep(block) {
  const input = block.input || {};
  const detail = input.command || input.file_path || input.notebook_path || input.pattern
    || input.url || input.query || input.description
    || (Array.isArray(input.todos) ? input.todos.map((todo) => todo?.subject || todo?.content).filter(Boolean).slice(0, 3).join(' · ') : '')
    || '';
  return {
    id: block.id,
    title: CLAUDE_TOOL_LABELS[block.name] || block.name || '执行工具',
    detail: String(detail).slice(0, 200),
    status: 'running',
  };
}

/** M1 口径：从 Edit/Write 的 tool_use.input 合成 diff，喂现有审阅 UI。 */
function registerClaudeChange(found, assistant, block) {
  const input = block.input || {};
  const rawPath = input.file_path || input.notebook_path || '';
  if (!rawPath) return;
  const path = projectRelativePath(found.project.path, rawPath) || rawPath;
  let removed = [];
  let added = [];
  if (block.name === 'Edit') {
    if (input.old_string) removed = String(input.old_string).split(/\r?\n/);
    if (input.new_string) added = String(input.new_string).split(/\r?\n/);
  } else if (block.name === 'Write') {
    added = String(input.content || '').split(/\r?\n/);
  } else if (block.name === 'MultiEdit') {
    (input.edits || []).forEach((edit) => {
      if (edit?.old_string) removed.push(...String(edit.old_string).split(/\r?\n/));
      if (edit?.new_string) added.push(...String(edit.new_string).split(/\r?\n/));
    });
  } else if (block.name === 'NotebookEdit') {
    added = String(input.new_source || '').split(/\r?\n/);
  } else {
    return;
  }
  if (!removed.length && !added.length) return;
  const body = [...removed.map((line) => `-${line}`), ...added.map((line) => `+${line}`)].join('\n');
  const { session } = found;
  session.claudeDiffByPath ||= {};
  session.claudeDiffByPath[path] = `${session.claudeDiffByPath[path] || ''}${body}\n`;
  session.realDiff = Object.entries(session.claudeDiffByPath)
    .map(([p, b]) => `diff --git a/${p} b/${p}\n--- a/${p}\n+++ b/${p}\n${b}`)
    .join('');
  assistant.changes = changesFromDiff(session.realDiff);
}

function claudeApprovalDetail(request) {
  const input = request.input || {};
  if (typeof input.command === 'string') return input.command;
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.url === 'string') return input.url;
  try {
    return JSON.stringify(input, null, 2).slice(0, 2000);
  } catch {
    return '';
  }
}

function handleClaudeControlRequest(found, message) {
  const request = message?.request || {};
  if (request.subtype !== 'can_use_tool') return;
  const assistant = ensureClaudeAssistant(found.session);
  assistant.approval = {
    requestId: message.request_id,
    kind: /Edit|Write|Notebook/i.test(request.tool_name || '') ? 'file'
      : /WebFetch|WebSearch/i.test(request.tool_name || '') ? 'network' : 'command',
    toolName: request.tool_name || '',
    input: request.input || {},
    reason: stripAnsi(request.decision_reason || ''),
    detail: claudeApprovalDetail(request),
    suggestions: Array.isArray(request.permission_suggestions) ? request.permission_suggestions : [],
    suppressAlways: !!request.suppress_always_allow_rule,
    resolved: false,
  };
  updateClaudeView(found, true);
}

async function respondClaudeApproval(messageId, decision) {
  const found = ensureSelection();
  const message = found?.session?.messages?.find((item) => item.id === messageId);
  if (!message?.approval || message.approval.resolved) return;
  const approval = message.approval;
  let result;
  if (decision === 'accept') {
    result = { behavior: 'allow', updatedInput: approval.input || {} };
  } else if (decision === 'acceptForSession') {
    // 优先采用 CLI 给的 session 目标建议；destination 只用 session，不写用户 settings。
    const suggestions = (approval.suggestions || []).filter((item) => item?.destination === 'session' && item?.behavior === 'allow');
    result = {
      behavior: 'allow',
      updatedInput: approval.input || {},
      updatedPermissions: suggestions.length ? suggestions : [{
        type: 'addRules',
        rules: [{ toolName: approval.toolName }],
        behavior: 'allow',
        destination: 'session',
      }],
    };
  } else {
    result = { behavior: 'deny', message: '用户拒绝了此操作' };
  }
  try {
    await deps.invoke('claude_respond', {
      sessionKey: found.session.id,
      requestId: approval.requestId,
      result,
    });
    approval.resolved = true;
    approval.decision = decision;
    updateClaudeView(found, true);
  } catch (error) {
    window.UIDialog?.toast?.(`审批响应失败：${error?.message || error}`);
  }
}

async function refreshClaudeContext(found) {
  try {
    const usage = await claudeControl(found.session.id, 'get_context_usage', {});
    const total = Number(usage?.totalTokens) || 0;
    const max = Number(usage?.maxTokens) || 0;
    let pct = max ? (total / max) * 100 : Number(usage?.percentage) || 0;
    if (!max && pct > 0 && pct <= 1) pct *= 100;
    found.session.contextPct = Math.min(100, Math.round(pct));
    found.session.contextKnown = true;
    updateClaudeView(found, true);
  } catch {
    // 上下文用量拉取失败不影响主流程。
  }
}

function handleClaudeMessage(found, message = {}) {
  const { session } = found;
  const type = message.type;
  if (type === 'system') {
    if (message.subtype === 'init' && message.session_id) {
      session.claudeSessionId = message.session_id;
      mockData.claude.currentModel = message.model || mockData.claude.currentModel;
    }
    return;
  }
  if (type === 'stream_event') {
    if (message.parent_tool_use_id) return; // 子代理内部流不进主时间线
    const event = message.event || {};
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      const assistant = ensureClaudeAssistant(session);
      if (assistant.needsSeparator && assistant.content) assistant.content += '\n\n';
      assistant.needsSeparator = false;
      assistant.content += event.delta.text || '';
      assistant.pending = false;
      updateClaudeView(found);
    }
    return;
  }
  if (type === 'assistant') {
    if (message.parent_tool_use_id) return;
    const inner = message.message || {};
    const assistant = ensureClaudeAssistant(session);
    const isApiError = inner.model === '<synthetic>' || message.is_api_error_message || inner.is_api_error_message;
    (inner.content || []).forEach((block) => {
      if (block?.type === 'tool_use') {
        assistant.steps ||= [];
        if (!assistant.steps.some((step) => step.id === block.id)) assistant.steps.push(claudeToolStep(block));
        registerClaudeChange(found, assistant, block);
        assistant.needsSeparator = true;
      } else if (block?.type === 'text' && isApiError && block.text) {
        assistant.pending = false;
        assistant.content = assistant.content ? `${assistant.content}\n\n${block.text}` : block.text;
      }
    });
    updateClaudeView(found);
    return;
  }
  if (type === 'user') {
    const blocks = message.message?.content;
    if (!Array.isArray(blocks)) return;
    const assistant = claudeAssistantMessage(session);
    if (!assistant) return;
    blocks.forEach((block) => {
      if (block?.type !== 'tool_result') return;
      const step = assistant.steps?.find((item) => item.id === block.tool_use_id);
      if (step && step.status === 'running') step.status = block.is_error ? 'failed' : 'done';
    });
    updateClaudeView(found);
    return;
  }
  if (type === 'result') {
    session.running = false;
    mockData.claude.running = false;
    const assistant = claudeAssistantMessage(session);
    if (assistant) {
      assistant.pending = false;
      assistant.needsSeparator = false;
      if (!assistant.content) {
        assistant.content = message.is_error
          ? `Claude Code 错误：${message.result || message.subtype || '任务执行失败'}`
          : (message.result || '已完成本次任务。');
      }
      (assistant.steps || []).forEach((step) => {
        if (step.status === 'running') step.status = 'done';
      });
      if (assistant.approval && !assistant.approval.resolved) assistant.approval.resolved = true;
    }
    if (typeof message.total_cost_usd === 'number') {
      session.costUsd = (Number(session.costUsd) || 0) + message.total_cost_usd;
    }
    session.updated = '刚刚';
    updateClaudeView(found, true);
    refreshClaudeContext(found);
  }
  // 未知类型一律忽略（协议是开放集合）。
}

function handleClaudeEvent(payload = {}) {
  const found = findClaudeSessionByKey(payload.sessionKey);
  if (payload.kind === 'status') {
    if (payload.status === 'connected') {
      claudeAliveKeys.add(payload.sessionKey);
      mockData.claude.connectionStatus = 'connected';
    } else {
      claudeAliveKeys.delete(payload.sessionKey);
      if (found?.session) {
        if (found.session.running) {
          const assistant = claudeAssistantMessage(found.session);
          if (assistant) {
            assistant.pending = false;
            assistant.content ||= 'Claude Code 连接已断开，请重新发送任务。';
          }
        }
        found.session.running = false;
        delete found.session.starting;
      }
    }
    persistMockData();
    if (activeKind === 'claude') renderAgentWorkspace();
    return;
  }
  if (!found) return;
  if (payload.kind === 'controlRequest') return handleClaudeControlRequest(found, payload.message);
  if (payload.kind === 'message') return handleClaudeMessage(found, payload.message);
}

function applyClaudeInitialize(found, initialize = {}) {
  const models = Array.isArray(initialize.models) ? initialize.models : [];
  if (models.length) {
    claudeModels = models
      .map((item) => ({
        value: item?.value || item?.id || '',
        displayName: item?.displayName || item?.value || item?.id || '',
        description: item?.description || '',
        supportsEffort: !!item?.supportsEffort,
        supportedEffortLevels: Array.isArray(item?.supportedEffortLevels) ? item.supportedEffortLevels : [],
      }))
      .filter((item) => item.value);
    if (mockData.claude.model && !claudeModels.some((item) => item.value === mockData.claude.model)) {
      mockData.claude.model = '';
    }
    if (!mockData.claude.model && claudeModels.some((item) => item.value === 'default')) {
      mockData.claude.model = 'default';
    }
  }
  // resume 挂着审批的会话时，靠 pending_permission_requests 恢复审批卡。
  (Array.isArray(initialize.pending_permission_requests) ? initialize.pending_permission_requests : []).forEach((item) => {
    try {
      const request = item?.request || item || {};
      const requestId = item?.request_id || item?.requestId || request?.request_id;
      if (!requestId || !(request.tool_name || request.subtype === 'can_use_tool')) return;
      handleClaudeControlRequest(found, {
        request_id: requestId,
        request: { subtype: 'can_use_tool', ...request },
      });
    } catch {
      // 结构不符合预期时忽略该条
    }
  });
}

async function ensureClaudeSession(project, session) {
  if (claudeAliveKeys.has(session.id)) return;
  if (claudeStartPromises.has(session.id)) return claudeStartPromises.get(session.id);
  const promise = (async () => {
    mockData.claude.connectionStatus = 'connecting';
    session.starting = true;
    renderRuntimeState();
    try {
      const profile = CLAUDE_PERMISSIONS[mockData.claude.permission] || CLAUDE_PERMISSIONS.request;
      const started = await deps.invoke('claude_start', {
        sessionKey: session.id,
        cwd: project.path,
        resumeId: session.claudeSessionId || null,
        model: mockData.claude.model || null,
        effort: mockData.claude.effort || null,
        permissionMode: profile.mode,
      });
      const init = started?.init || {};
      if (init.session_id) session.claudeSessionId = init.session_id;
      if (init.model) mockData.claude.currentModel = init.model;
      claudeAliveKeys.add(session.id);
      mockData.claude.connectionStatus = 'connected';
      applyClaudeInitialize({ project, session }, started?.initialize || {});
    } catch (error) {
      mockData.claude.connectionStatus = 'error';
      throw error;
    } finally {
      delete session.starting;
      claudeStartPromises.delete(session.id);
      persistMockData();
      if (activeKind === 'claude') renderAgentWorkspace();
    }
  })();
  claudeStartPromises.set(session.id, promise);
  return promise;
}

function claudeImageBlock(dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!match) return null;
  return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
}

async function stopClaudeTurn() {
  const found = ensureSelection();
  if (!found?.session?.running) return;
  try {
    await claudeControl(found.session.id, 'interrupt', { cancel_queued: true });
  } catch (error) {
    window.UIDialog?.toast?.(`停止失败：${error?.message || error}`);
  }
}

async function sendClaudeMessage() {
  const input = $('#external-composer-input');
  const selected = ensureSelection();
  if (selected?.session?.running) {
    await stopClaudeTurn();
    return;
  }
  const content = input?.value.trim();
  if (!content && !composerAttachments.length) return;
  if (!selected) return;
  const { project, session } = selected;
  session.messages ||= [];
  const attachments = composerAttachments;
  session.messages.push({ id: uid('eam'), role: 'user', content, attachments, time: nowLabel() });
  const assistant = { id: uid('eam'), role: 'assistant', content: '', time: nowLabel(), pending: true, steps: [] };
  session.messages.push(assistant);
  session.updated = '刚刚';
  input.value = '';
  input.style.height = '';
  composerAttachments = [];
  mockData.claude.running = true;
  session.running = true;
  renderMessages();
  renderComposerState();
  renderRuntimeState();

  try {
    await ensureClaudeSession(project, session);
    if (!session.title || session.title === '新会话') {
      session.title = (content || attachments[0]?.name || '新会话').slice(0, 28);
      claudeControl(session.id, 'rename_session', { title: session.title }).catch(() => {});
    }
    const blocks = [
      ...(content ? [{ type: 'text', text: content }] : []),
      ...attachments.map((attachment) => claudeImageBlock(attachment.url)).filter(Boolean),
    ];
    await deps.invoke('claude_send', {
      sessionKey: session.id,
      message: { type: 'user', message: { role: 'user', content: blocks }, parent_tool_use_id: null },
    });
    persistMockData();
    renderAgentWorkspace();
  } catch (error) {
    assistant.pending = false;
    assistant.content = `无法启动 Claude Code：${error?.message || error}`;
    mockData.claude.running = false;
    session.running = false;
    persistMockData();
    renderAgentWorkspace();
  }
}

function sendMockMessage() {
  const input = $('#external-composer-input');
  const agentState = currentAgentState();
  if (agentState.running) {
    clearTimeout(responseTimer);
    responseTimer = 0;
    agentState.running = false;
    renderComposerState();
    return;
  }
  const content = input?.value.trim();
  if (!content) return;
  const found = ensureSelection();
  if (!found) return;
  found.session.messages ||= [];
  found.session.messages.push({ id: uid('eam'), role: 'user', content, time: '刚刚' });
  found.session.updated = '刚刚';
  input.value = '';
  input.style.height = '';
  agentState.running = true;
  renderMessages();
  renderComposerState();
  const kind = activeKind;
  const sessionId = found.session.id;
  responseTimer = window.setTimeout(() => {
    responseTimer = 0;
    const stateForAgent = mockData[kind];
    const target = stateForAgent.projects.flatMap((project) => project.sessions).find((session) => session.id === sessionId);
    if (!target) return;
    target.messages.push({
      id: uid('eam'),
      role: 'assistant',
      content: '这是界面阶段的 mock 响应。消息、工具状态与工作区联动已经就位，真实执行会在 Codex 连接层接入后替换这里。',
      time: '刚刚',
      steps: [{ title: '等待真实连接', detail: '当前未启动 CLI 或 RPC 进程', status: 'done' }],
    });
    stateForAgent.running = false;
    persistMockData();
    if (activeKind === kind && currentAgentState().selectedSessionId === sessionId) {
      renderMessages();
      renderComposerState();
    }
  }, 850);
}

function bind() {
  $('#external-enabled')?.addEventListener('click', (event) => {
    const button = event.currentTarget;
    setPressed(button, button.getAttribute('aria-pressed') !== 'true');
    renderAgentToggleAvailability();
  });
  AGENTS.forEach((agent) => {
    $(`#external-${agent.kind}-enabled`)?.addEventListener('click', (event) => {
      const button = event.currentTarget;
      setPressed(button, button.getAttribute('aria-pressed') !== 'true');
    });
  });
  $all('[data-external-detect]').forEach((button) => {
    button.addEventListener('click', () => detect(button.dataset.externalDetect));
  });
  $('#btn-save-external')?.addEventListener('click', saveSettings);
  $('#external-add-project')?.addEventListener('click', addProject);
  $('#external-project-search')?.addEventListener('input', renderProjectTree);
  $('#external-project-tree')?.addEventListener('click', handleTreeAction);
  $('#external-toggle-workspace')?.addEventListener('click', () => deps.setRightOpen?.(!deps.getState().rightOpen));
  $('#external-tab-add')?.addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = $('#external-tab-add-menu');
    if (!menu) return;
    const open = menu.hidden;
    menu.hidden = !open;
    $('#external-tab-add')?.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  $('#external-send')?.addEventListener('click', sendMessage);
  $('#external-composer-input')?.addEventListener('input', (event) => {
    event.target.style.height = '';
    event.target.style.height = `${Math.min(150, event.target.scrollHeight)}px`;
    renderComposerState();
  });
  $('#external-composer-input')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  });
  $('#external-chat-scroll')?.addEventListener('click', (event) => {
    const decision = event.target.closest('[data-codex-decision]');
    if (decision) {
      const approval = decision.closest('[data-approval-message]');
      if (activeKind === 'claude') respondClaudeApproval(approval?.dataset.approvalMessage, decision.dataset.codexDecision);
      else respondCodexApproval(approval?.dataset.approvalMessage, decision.dataset.codexDecision);
      return;
    }
    const starter = event.target.closest('[data-external-starter]');
    if (starter) {
      const input = $('#external-composer-input');
      if (input) input.value = starter.dataset.externalStarter;
      renderComposerState();
      input?.focus();
    }
    if (event.target.closest('[data-open-review]')) {
      deps.setRightOpen?.(true);
      openWorkspaceTab('review');
    }
  });
  $('#external-attach')?.addEventListener('click', () => $('#external-image-input')?.click());
  $('#external-image-input')?.addEventListener('change', async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    for (const file of files) {
      if (!String(file.type || '').startsWith('image/')) continue;
      try {
        composerAttachments.push({ id: uid('external-image'), name: file.name || '图片', url: await readImageAsDataUrl(file) });
      } catch (error) {
        window.UIDialog?.toast?.(`无法添加图片：${error?.message || error}`);
      }
    }
    renderComposerState();
  });
  $('#external-permission-toggle')?.addEventListener('click', () => {
    renderPermissionMenu();
    toggleExternalPopover('external-permission-menu', 'external-permission-toggle');
  });
  $('#external-model-toggle')?.addEventListener('click', () => {
    renderModelMenu();
    toggleExternalPopover('external-model-menu', 'external-model-toggle');
  });
  $('#external-open-project')?.addEventListener('click', showOpenProjectMenu);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.external-popover-wrap, .external-open-wrap')) closeExternalPopovers();
    if (!event.target.closest('#external-tab-add-wrap')) closeExternalTabAddMenu();
    const remove = event.target.closest('[data-external-remove-attachment]');
    if (remove) {
      composerAttachments = composerAttachments.filter((item) => item.id !== remove.dataset.externalRemoveAttachment);
      renderComposerState();
      return;
    }
    const permission = event.target.closest('[data-external-permission]');
    if (permission) {
      currentAgentState().permission = permission.dataset.externalPermission;
      if (activeKind === 'claude') {
        const session = findSession()?.session;
        const profile = CLAUDE_PERMISSIONS[mockData.claude.permission] || CLAUDE_PERMISSIONS.request;
        if (session && claudeAliveKeys.has(session.id)) {
          claudeControl(session.id, 'set_permission_mode', { mode: profile.mode })
            .catch((error) => window.UIDialog?.toast?.(`切换权限失败：${error?.message || error}`));
        }
      }
      persistMockData();
      closeExternalPopovers();
      renderComposerState();
      return;
    }
    const model = event.target.closest('[data-external-model]');
    if (model) {
      if (activeKind === 'claude') {
        mockData.claude.model = model.dataset.externalModel;
        const session = findSession()?.session;
        if (session && claudeAliveKeys.has(session.id)) {
          claudeControl(session.id, 'set_model', { model: mockData.claude.model })
            .catch((error) => window.UIDialog?.toast?.(`切换模型失败：${error?.message || error}`));
        }
      } else {
        mockData.codex.model = model.dataset.externalModel;
        const selected = selectedCodexModel();
        if (!supportedEfforts(selected).includes(mockData.codex.effort)) mockData.codex.effort = selected?.defaultReasoningEffort || '';
      }
      persistMockData();
      renderComposerState();
      return;
    }
    const effort = event.target.closest('[data-external-effort]');
    if (effort) {
      // claude 的推理档在下一次进程启动时经 --effort 生效（运行中切换见 M3 实测清单）。
      currentAgentState().effort = effort.dataset.externalEffort;
      persistMockData();
      renderComposerState();
      return;
    }
    const target = event.target.closest('[data-external-open-target]');
    if (target) {
      const project = ensureSelection()?.project;
      if (project) deps.invoke('external_project_open', { path: project.path, target: target.dataset.externalOpenTarget })
        .catch((error) => window.UIDialog?.toast?.(`无法打开项目：${error?.message || error}`));
      closeExternalPopovers();
    }
  });
}

export function isAgentMode(mode) {
  return /^agent-(codex|pi|claude)$/.test(String(mode || ''));
}

export function initExternalAgentMode(options) {
  deps = options;
  bind();
  const eventApi = window.__TAURI__?.event;
  if (eventApi?.listen && !codexUnlisten) {
    eventApi.listen('codex-app-server', (event) => handleCodexEvent(event?.payload || {}))
      .then((unlisten) => { codexUnlisten = unlisten; })
      .catch((error) => console.warn('listen codex app-server', error));
  }
  if (eventApi?.listen && !claudeUnlisten) {
    eventApi.listen('claude-agent', (event) => handleClaudeEvent(event?.payload || {}))
      .then((unlisten) => { claudeUnlisten = unlisten; })
      .catch((error) => console.warn('listen claude agent', error));
  }
  if (eventApi?.listen && !powerShellUnlisten) {
    eventApi.listen('powershell-terminal', (event) => handlePowerShellEvent(event?.payload || {}))
      .then((unlisten) => { powerShellUnlisten = unlisten; })
      .catch((error) => console.warn('listen powershell terminal', error));
  }
  deps.invoke('codex_status').then((status) => {
    mockData.codex.connectionStatus = status?.connected ? 'connected' : 'disconnected';
    if (!status?.connected) clearCodexRuntime(false);
    persistMockData();
  }).catch(() => {});
  deps.invoke('claude_status').then((status) => {
    const alive = new Set(status?.sessions || []);
    claudeAliveKeys.clear();
    alive.forEach((key) => claudeAliveKeys.add(key));
    mockData.claude.projects.flatMap((project) => project.sessions).forEach((session) => {
      delete session.starting;
      if (!alive.has(session.id)) session.running = false;
    });
    mockData.claude.running = mockData.claude.projects.some((project) => project.sessions.some((session) => session.running));
    persistMockData();
  }).catch(() => {});
  window.ExternalAgentMode = {
    refresh,
    enter,
    exit,
    renderWorkspace: renderRightWorkspace,
    syncNavigation,
    isAgentMode,
  };
}

function enter(kind) {
  if (!AGENTS.some((item) => item.kind === kind)) return;
  activeKind = kind;
  $('#app-body')?.classList.add('is-external-agent-mode');
  const pane = $('#right-pane');
  pane?.classList.add('is-external-workspace');
  deps.setRightOpen?.(true);
  renderAgentWorkspace();
}

function exit() {
  clearTimeout(responseTimer);
  responseTimer = 0;
  if (activeKind !== 'codex' && currentAgentState()) currentAgentState().running = false;
  const pane = $('#right-pane');
  $('#app-body')?.classList.remove('is-external-agent-mode');
  pane?.classList.remove('is-external-workspace');
  closeExternalTabAddMenu();
  const externalAddWrap = $('#external-tab-add-wrap');
  if (externalAddWrap) externalAddWrap.hidden = true;
  const chatAddWrap = chatTabAddWrap();
  if (chatAddWrap) chatAddWrap.hidden = false;
}

async function refresh() {
  renderSettings();
}
