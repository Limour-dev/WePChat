// 端到端最小验证:initialize → user 消息 → 观察 init/stream/result 时序
const { spawn } = require('child_process');
const exe = process.argv[2];
const child = spawn(exe, [
  '--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json',
  '--include-partial-messages', '--permission-mode', 'default',
], { cwd: process.env.TEMP });
const t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
let buf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (d) => {
  buf += d;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.type === 'control_response') {
      console.log(`[${stamp()}] control_response ok (models: ${msg.response?.response?.models?.length})`);
      child.stdin.write(JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: '只回复两个字符:ok' }] },
        parent_tool_use_id: null,
      }) + '\n');
    } else if (msg.type === 'system' && msg.subtype === 'init') {
      console.log(`[${stamp()}] system/init session_id=${msg.session_id} model=${msg.model} permissionMode=${msg.permissionMode}`);
    } else if (msg.type === 'stream_event') {
      const dt = msg.event?.delta?.type;
      if (dt) console.log(`[${stamp()}] stream_event delta=${dt} text=${JSON.stringify(msg.event.delta.text || msg.event.delta.thinking || '').slice(0, 40)}`);
    } else if (msg.type === 'result') {
      console.log(`[${stamp()}] result subtype=${msg.subtype} is_error=${msg.is_error} cost=${msg.total_cost_usd} result=${JSON.stringify(msg.result).slice(0, 60)}`);
      // 顺带验证 get_context_usage 与 rename_session
      child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'wc-ctx', request: { subtype: 'get_context_usage' } }) + '\n');
    } else if (msg.type === 'control_response' || msg.type === 'assistant' || msg.type === 'user') {
      console.log(`[${stamp()}] ${msg.type}`);
    } else {
      console.log(`[${stamp()}] ${msg.type}/${msg.subtype || ''}`);
    }
    if (msg.type === 'control_response' && msg.response?.request_id === 'wc-ctx') {
      console.log(`[${stamp()}] context_usage:`, JSON.stringify(msg.response?.response).slice(0, 300));
      child.kill();
      process.exit(0);
    }
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => console.log(`[stderr ${stamp()}]`, d.trim().slice(0, 200)));
child.on('exit', (code) => { console.log(`[exit ${stamp()}] code=${code}`); process.exit(0); });
child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'wc-1', request: { subtype: 'initialize' } }) + '\n');
setTimeout(() => { console.log('[timeout] kill'); child.kill(); process.exit(1); }, 120000);
