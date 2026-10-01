// Diag 2: bedah fetch data/index.json.gz di dalam halaman
import { spawn } from 'child_process';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9225', '--user-data-dir=' + process.env.TEMP + '/buffy-chrome-diag2', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 20 && !wsUrl; i++) {
  await sleep(500);
  try {
    const tabs = await (await fetch('http://127.0.0.1:9225/json')).json();
    wsUrl = tabs.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch {}
}
const ws = new WebSocket(wsUrl);
let msgId = 0; const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(3000);

const probe = await send('Runtime.evaluate', {
  expression: `(async () => {
    const out = {};
    try {
      const res = await fetch('data/index.json.gz');
      out.status = res.status;
      out.ok = res.ok;
      out.ce = res.headers.get('content-encoding');
      out.ct = res.headers.get('content-type');
      out.cl = res.headers.get('content-length');
      out.swControlled = !!navigator.serviceWorker.controller;
      const regs = await navigator.serviceWorker.getRegistrations();
      out.swCount = regs.length;
      if (res.ok) {
        const buf = await res.arrayBuffer();
        out.bytes = buf.byteLength;
      }
    } catch (e) { out.fetchError = String(e); }
    return JSON.stringify(out);
  })()`,
  awaitPromise: true,
  returnByValue: true,
});
console.log(probe.result?.value);
ws.close(); chrome.kill();
