/**
 * WePChat Windows — 会话大纲 rail（消息定位条）。
 *
 * 形态参照行业惯例（Gemini 会话大纲 / Notion outline / scrollspy）：
 * - 贴主区左缘的一列短横杠，每条用户提问一根；点击平滑跳转到该消息（居中）。
 * - hover 在右侧浮出一行摘要；整条 rail hover 时刻度整体加深。
 * - 滚动时按 scrollspy 规则高亮当前位置：滚动到顶/底强制首/末项，
 *   其余取「顶部 35% 探针线之上最近的一条」——避免最后一条永远点不亮的经典 bug。
 * - 命中区连续（每格 28×16px），视觉杠只有 14×3px，点击不再需要瞄准。
 * - 用户提问少于 2 条时隐藏；刻度超出可视高度时活动刻度保持居中。
 *
 * 工厂用法（常规聊天 / 生图 / external agent 三处共用）：
 *   const rail = createChatRail({ root, scrollHost, getMessageElement, onJump? });
 *   rail.update(session.messages);
 */

const MIN_TICKS = 2;
const EDGE_EPSILON = 4;
const PROBE_RATIO = 0.35;
const JUMP_UNLOCK_MS = 180;

function summarize(text) {
  const line = String(text || '').split(/\r?\n/).find((l) => l.trim()) || '';
  const compact = line.replace(/\s+/g, ' ').trim();
  return compact.length > 72 ? compact.slice(0, 71) + '…' : compact;
}

export function createChatRail(options) {
  const root = options.root;
  const scrollHost = options.scrollHost || options.chatHost;
  const getMessageElement = options.getMessageElement;
  const onJump = options.onJump
    || ((el) => el.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  if (!root || !scrollHost) return null;

  const viewport = root.querySelector('.chat-rail-viewport') || root;
  const track = root.querySelector('.chat-rail-track');
  const tip = root.querySelector('.chat-rail-tip');

  let entries = [];     // [{ id, summary, el(tick) }]
  let entriesFp = '';
  let activeId = '';
  let scrollRaf = 0;
  let jumpLockId = '';
  let jumpUnlockTimer = 0;

  function showTip(entry) {
    if (!tip || !entry.summary) return;
    tip.textContent = entry.summary;
    tip.hidden = false;
    const railRect = root.getBoundingClientRect();
    const tickRect = entry.el.getBoundingClientRect();
    tip.style.top = `${tickRect.top - railRect.top + tickRect.height / 2}px`;
  }

  function hideTip() {
    if (tip) tip.hidden = true;
  }

  /** 刻度超出 rail 可视高度时，让活动刻度尽量停在中央 */
  function centerActive(entry) {
    if (!track || !viewport) return;
    const trackH = track.scrollHeight;
    const viewH = viewport.clientHeight;
    if (trackH <= viewH) {
      track.style.transform = '';
      return;
    }
    const offset = entry.el.offsetTop + entry.el.offsetHeight / 2 - viewH / 2;
    const max = trackH - viewH;
    const y = Math.max(0, Math.min(max, offset));
    track.style.transform = `translateY(${-y}px)`;
  }

  function activateEntry(entry) {
    if (!entry) return;
    activeId = entry.id;
    entries.forEach((e) => e.el.classList.toggle('is-active', e === entry));
    centerActive(entry);
  }

  /** scrollspy：顶/底强制首/末项，中段用探针线 */
  function syncActive() {
    if (!entries.length) return;
    const maxTop = scrollHost.scrollHeight - scrollHost.clientHeight;
    let current;
    if (maxTop <= EDGE_EPSILON || scrollHost.scrollTop >= maxTop - EDGE_EPSILON) {
      current = entries[entries.length - 1];
    } else if (scrollHost.scrollTop <= EDGE_EPSILON) {
      current = entries[0];
    } else {
      const hostRect = scrollHost.getBoundingClientRect();
      const probe = hostRect.top + hostRect.height * PROBE_RATIO;
      current = entries[0];
      for (const entry of entries) {
        const el = getMessageElement?.(entry.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= probe) current = entry;
        else break;
      }
    }
    if (current && current.id !== activeId) activateEntry(current);
  }

  function scheduleSync() {
    if (scrollRaf || !entries.length) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      syncActive();
    });
  }

  function armJumpUnlock() {
    clearTimeout(jumpUnlockTimer);
    jumpUnlockTimer = setTimeout(() => {
      jumpUnlockTimer = 0;
      jumpLockId = '';
      scheduleSync();
    }, JUMP_UNLOCK_MS);
  }

  function handleScroll() {
    // smooth scroll 途中保持用户刚点击的刻度，结束后再按实际视口同步。
    if (jumpLockId) armJumpUnlock();
    else scheduleSync();
  }

  scrollHost.addEventListener('scroll', handleScroll, { passive: true });

  function update(messages) {
    if (!track) return;
    const users = (messages || []).filter((m) => m.role === 'user');
    if (users.length < MIN_TICKS) {
      root.hidden = true;
      entries = [];
      entriesFp = '';
      activeId = '';
      jumpLockId = '';
      clearTimeout(jumpUnlockTimer);
      hideTip();
      return;
    }
    const fp = users.map((m) => m.id + ':' + String(m.content || '').slice(0, 96)).join('|');
    root.hidden = false;
    if (fp === entriesFp) {
      scheduleSync();
      return;
    }
    entriesFp = fp;
    activeId = '';
    jumpLockId = '';
    clearTimeout(jumpUnlockTimer);
    track.style.transform = '';
    track.innerHTML = '';
    entries = users.map((m) => {
      const tick = document.createElement('button');
      tick.type = 'button';
      tick.className = 'chat-rail-tick';
      tick.dataset.messageId = m.id;
      tick.setAttribute('aria-label', summarize(m.content) || '定位消息');
      const entry = { id: m.id, summary: summarize(m.content), el: tick };
      tick.addEventListener('click', () => {
        hideTip();
        const target = getMessageElement?.(m.id);
        if (target) {
          jumpLockId = entry.id;
          activateEntry(entry);
          armJumpUnlock();
          onJump(target);
        }
      });
      tick.addEventListener('mouseenter', () => showTip(entry));
      tick.addEventListener('mouseleave', hideTip);
      tick.addEventListener('focus', () => showTip(entry));
      tick.addEventListener('blur', hideTip);
      track.appendChild(tick);
      return entry;
    });
    scheduleSync();
  }

  function destroy() {
    scrollHost.removeEventListener('scroll', handleScroll);
    clearTimeout(jumpUnlockTimer);
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    if (track) track.innerHTML = '';
    entries = [];
    root.hidden = true;
  }

  return { update, destroy };
}

// 非 module 脚本（image-mode.js）通过全局访问
if (typeof window !== 'undefined') {
  window.ChatRail = { create: createChatRail };
}
