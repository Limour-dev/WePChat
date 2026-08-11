/* WepChat - 统一控制台埋点日志
 * 所有模块通过 WLog 输出，方便过滤和定位问题。
 * 生产环境可通过 WLog.level 调整 verbosity。 */
'use strict';

const WLog = (() => {
  const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
  let currentLevel = LEVELS.debug;
  const PREFIX = '[WepChat]';

  function ts() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  function fmt(tag, args) {
    const parts = [PREFIX + '[' + ts() + '][' + tag + ']'];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a instanceof Error) parts.push(a.message + (a.code ? ' (' + a.code + ')' : '') + (a.stack ? '\n' + a.stack : ''));
      else if (typeof a === 'object' && a !== null) {
        try { parts.push(JSON.stringify(a, (k, v) => {
          // 脱敏：不打印 apiKey / hash / salt 等敏感字段
          if (/^(apiKey|api_key|secret|password|hash|salt|authorization)$/i.test(k)) return '***REDACTED***';
          // 截断超长字符串（如 base64 图片）
          if (typeof v === 'string' && v.length > 300) return v.slice(0, 200) + '…[' + v.length + ' chars]';
          return v;
        }, 2)); } catch (e) { parts.push(String(a)); }
      } else parts.push(String(a));
    }
    return parts.join(' ');
  }

  function log(level, tag, args) {
    if (LEVELS[level] < currentLevel) return;
    const msg = fmt(tag, args);
    if (level === 'error') console.error(msg);
    else if (level === 'warn') console.warn(msg);
    else if (level === 'info') console.info(msg);
    else console.log(msg);
  }

  return {
    get level() { return Object.keys(LEVELS).find(k => LEVELS[k] === currentLevel) || 'debug'; },
    set level(v) { if (LEVELS[v] != null) currentLevel = LEVELS[v]; },
    debug: (tag, ...args) => log('debug', tag, args),
    info:  (tag, ...args) => log('info',  tag, args),
    warn:  (tag, ...args) => log('warn',  tag, args),
    error: (tag, ...args) => log('error', tag, args),
    /** 计时辅助：const end = WLog.time('API'); ... end('done'); */
    time(tag) {
      const start = Date.now();
      return (detail) => {
        const ms = Date.now() - start;
        log('info', tag, [(detail || '') + ' ' + ms + 'ms']);
      };
    }
  };
})();

window.WLog = WLog;
