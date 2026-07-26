// 抓取 initialize 应答完整结构(只看 keys 与 models)
const { spawn } = require('child_process');
const exe = process.argv[2];
const child = spawn(exe, [
  '--print', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json',
  '--include-partial-messages', '--permission-mode', 'default',
]);
let buf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (d) => {
  buf += d;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.type === 'control_response') {
        const resp = msg.response?.response || {};
        console.log('keys:', Object.keys(resp).join(', '));
        console.log('models:', JSON.stringify(resp.models, null, 1)?.slice(0, 2500));
        console.log('account:', JSON.stringify(resp.account)?.slice(0, 300));
        console.log('pending_permission_requests:', JSON.stringify(resp.pending_permission_requests)?.slice(0, 300));
        child.kill();
        process.exit(0);
      }
    } catch {}
  }
});
child.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'wc-1', request: { subtype: 'initialize' } }) + '\n');
setTimeout(() => { child.kill(); process.exit(1); }, 30000);
