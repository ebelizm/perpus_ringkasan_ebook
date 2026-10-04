// Cek posisi & clipping tiap kontrol di filterbar pada 390px.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9247;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-sel2-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 20 && !wsUrl; i++) {
  await sleep(500);
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
}
const ws = new WebSocket(wsUrl);
let id = 0; const p = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Page.enable'); await send('Runtime.enable');
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.value;
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(3000);
console.log(await ev(`JSON.stringify((() => {
  const bar = document.querySelector('.filterbar-inner');
  const bb = bar.getBoundingClientRect();
  const rows = [];
  for (const c of bar.querySelectorAll('*')) {
    const r = c.getBoundingClientRect();
    if (r.width < 2) continue;
    rows.push([c.tagName + '.' + (c.className || ''), Math.round(r.x), Math.round(r.right), Math.round(r.width), c.textContent.trim().slice(0, 18)]);
  }
  return { bar: { x: Math.round(bb.x), w: Math.round(bb.width), scrollW: bar.scrollWidth }, rows };
})(), null, 1)`));
ws.close(); chrome.kill();