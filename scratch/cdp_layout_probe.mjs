// Probe lebar: cek apakah kolom grid benar-benar muat di viewport.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9237;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-probe-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--window-size=390,844', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 20 && !wsUrl; i++) {
  await sleep(500);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/json`);
    wsUrl = (await res.json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch {}
}
const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => (ws.onopen = r));
await send('Page.enable'); await send('Runtime.enable');
const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.value;

for (const w of [320, 360, 390, 430, 460, 640, 768, 1280]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 2, mobile: w < 900 });
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await sleep(2200);
  const r = await ev(`JSON.stringify((() => {
    const g = document.getElementById('grid');
    const cs = getComputedStyle(g);
    const cards = [...g.querySelectorAll('.card')].slice(0, 4).map(c => Math.round(c.getBoundingClientRect().width));
    const last = g.querySelector('.card:last-child');
    return {
      vw: innerWidth,
      cols: cs.gridTemplateColumns,
      gridW: Math.round(g.getBoundingClientRect().width),
      scrollW: g.scrollWidth,
      cardW: cards[0],
      lastRight: last ? Math.round(last.getBoundingClientRect().right) : null,
      coverH: Math.round((g.querySelector('.card-cover') || {}).clientHeight || 0),
      badgeW: Math.round((g.querySelector('.badge') || {}).offsetWidth || 0),
      wordsW: Math.round((g.querySelector('.card-words') || {}).offsetWidth || 0),
    };
  })())`);
  console.log(w + 'px →', r);
}
ws.close(); chrome.kill();