// 探测 claude --print stream-json 的握手时序:
// 1) 启动后不发任何东西,看 5s 内是否有 system/init
// 2) 发 initialize control_request,看是否有应答
const { spawn } = require('child_process');

const exe = process.argv[2] || 'claude';
const args = [
  '--print', '--verbose',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--include-partial-messages',
  '--permission-mode', 'default',
];
console.log('[probe] spawn:', exe, args.join(' '));
const child = spawn(exe, args, { shell: exe.endsWith('.cmd'), cwd: process.cwd() });
const t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

child.stdout.setEncoding('utf8');
let buf = '';
child.stdout.on('data', (d) => {
  buf += d;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) console.log(`[stdout ${stamp()}]`, line.slice(0, 600));
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => console.log(`[stderr ${stamp()}]`, d.trim().slice(0, 400)));
child.on('exit', (code) => { console.log(`[exit ${stamp()}] code=${code}`); process.exit(0); });

setTimeout(() => {
  console.log(`[probe ${stamp()}] 5s 静默期结束,发送 initialize control_request`);
  child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'wc-1', request: { subtype: 'initialize' } }) + '\n');
}, 5000);

setTimeout(() => {
  console.log(`[probe ${stamp()}] 结束探测,kill`);
  child.kill();
  process.exit(0);
}, 20000);
