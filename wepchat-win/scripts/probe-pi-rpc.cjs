// pi --mode rpc 零成本探测:get_state / get_available_models / get_commands
const { spawn } = require('child_process');
const child = spawn(process.env.APPDATA + '\\npm\\pi.cmd', ['--mode', 'rpc', '--no-session'], { shell: true, cwd: process.env.TEMP });
const t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
let buf = '';
const queue = [
  { id: 'q1', type: 'get_state' },
  { id: 'q2', type: 'get_available_models' },
  { id: 'q3', type: 'get_commands' },
];
child.stdout.setEncoding('utf8');
child.stdout.on('data', (d) => {
  buf += d;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    let line = buf.slice(0, idx); buf = buf.slice(idx + 1);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch { console.log(`[${stamp()}] protocol-error:`, line.slice(0, 120)); continue; }
    if (msg.type === 'response') {
      if (msg.command === 'get_state') console.log(`[${stamp()}] state:`, JSON.stringify(msg.data).slice(0, 400));
      else if (msg.command === 'get_available_models') {
        const models = msg.data?.models || [];
        console.log(`[${stamp()}] models: ${models.length}`);
        models.slice(0, 6).forEach((m) => console.log(`  - ${m.provider}/${m.id} ctx=${m.contextWindow} reasoning=${m.reasoning} input=${(m.input||[]).join('+')}`));
      } else if (msg.command === 'get_commands') {
        console.log(`[${stamp()}] commands: ${(msg.data?.commands || []).length}`);
        child.kill(); process.exit(0);
      }
    } else {
      console.log(`[${stamp()}] event: ${msg.type}`);
    }
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => console.log(`[stderr ${stamp()}]`, d.trim().slice(0, 200)));
child.on('exit', (c) => { console.log(`[exit ${stamp()}] ${c}`); process.exit(0); });
queue.forEach((q) => child.stdin.write(JSON.stringify(q) + '\n'));
setTimeout(() => { console.log('[timeout]'); child.kill(); process.exit(1); }, 30000);
