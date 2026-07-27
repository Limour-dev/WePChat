// pi --mode rpc 零成本探测:node 直启 cli.js、--approve、--session 恢复 + get_messages 结构
const { spawn } = require('child_process');
const sessionFile = process.argv[2] || '';
const args = ['--mode', 'rpc', '--approve'];
if (sessionFile) args.push('--session', sessionFile);
const cli = process.env.APPDATA + '\\npm\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js';
const child = spawn('node', [cli, ...args], { cwd: 'E:\\pi-desktop' });
const t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
let buf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (d) => {
  buf += d;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    let line = buf.slice(0, idx); buf = buf.slice(idx + 1);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch { console.log(`[${stamp()}] parse-error:`, line.slice(0, 120)); continue; }
    if (msg.type === 'response') {
      if (msg.command === 'get_state') {
        console.log(`[${stamp()}] state:`, JSON.stringify({ ...msg.data, model: msg.data?.model ? `${msg.data.model.provider}/${msg.data.model.id} input=${(msg.data.model.input || []).join('+')}` : null }));
        child.stdin.write(JSON.stringify({ id: 'q2', type: 'get_messages' }) + '\n');
      } else if (msg.command === 'get_messages') {
        const messages = msg.data?.messages || [];
        console.log(`[${stamp()}] messages: ${messages.length}`);
        messages.slice(0, 8).forEach((m) => {
          const summary = m.role === 'assistant'
            ? (m.content || []).map((c) => c.type).join(',')
            : typeof m.content === 'string' ? m.content.slice(0, 60) : JSON.stringify(m.content).slice(0, 60);
          console.log(`  - role=${m.role} stop=${m.stopReason || ''} :: ${summary}`);
        });
        // 运行外发不带 streamingBehavior 的 prompt 属正常路径;此处测 abort 的空转行为后退出
        child.stdin.write(JSON.stringify({ id: 'q3', type: 'get_session_stats' }) + '\n');
      } else if (msg.command === 'get_session_stats') {
        console.log(`[${stamp()}] stats:`, JSON.stringify(msg.data).slice(0, 300));
        child.kill(); process.exit(0);
      }
    } else {
      console.log(`[${stamp()}] event: ${msg.type}`);
    }
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => console.log(`[stderr ${stamp()}]`, d.trim().slice(0, 200)));
child.on('exit', (c) => { console.log(`[exit ${stamp()}] code=${c}`); process.exit(0); });
child.stdin.write(JSON.stringify({ id: 'q1', type: 'get_state' }) + '\n');
setTimeout(() => { console.log('[timeout] kill'); child.kill(); process.exit(1); }, 30000);
