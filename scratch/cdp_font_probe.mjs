// Probe tipografi: bobot & ukuran font nyata per elemen (desktop & mobile).
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9241;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-f-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 20 && !wsUrl; i++) {
  await sleep(500);
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
}
const s = new WebSocket(wsUrl);
let id = 0; const p = new Map();
s.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); s.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (s.onopen = r));
await send('Page.enable'); await send('Runtime.enable');
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.value;

const probe = `JSON.stringify((() => {
  const o = {};
  for (const el of document.querySelectorAll('body *')) {
    if (!el.textContent.trim() || el.children.length) continue;
    const cs = getComputedStyle(el);
    const k = cs.fontWeight + ' ' + cs.fontSize;
    (o[k] = o[k] || []).push((el.tagName + '.' + (el.className || '')).slice(0, 40));
  }
  return o;
})(), null, 1)`;

for (const [label, mobile] of [['mobile-390', true], ['desktop-1280', false]]) {
  await send('Emulation.setDeviceMetricsOverride', { width: mobile ? 390 : 1280, height: 900, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await sleep(3000);
  console.log('### ' + label + '\n' + (await ev(probe)));
}
s.close(); chrome.kill();