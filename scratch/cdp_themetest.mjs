// Uji tema light/dark via CDP + screenshot kedua tema
import { execSync, spawn } from 'child_process';
import fs from 'fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

try { execSync('taskkill /F /IM chrome.exe', { shell: 'cmd.exe', stdio: 'ignore' }); } catch {}
await new Promise((r) => setTimeout(r, 1500));

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--remote-debugging-port=9222',
  '--window-size=390,844',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wsUrl = null;
for (let i = 0; i < 20 && !wsUrl; i++) {
  await sleep(500);
  try {
    const res = await fetch('http://127.0.0.1:9222/json');
    const tabs = await res.json();
    wsUrl = tabs.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch {}
}
if (!wsUrl) { console.log('GAGAL konek CDP'); chrome.kill(); process.exit(1); }

const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
};
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await new Promise((r) => (ws.onopen = r));
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(3500);

const evalJson = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result?.value;
};

fs.mkdirSync('scratch/shots', { recursive: true });

// === kondisi awal (mengikuti prefers-color-scheme headless = light) ===
const init = await evalJson(`(() => {
  const cs = getComputedStyle(document.documentElement);
  return JSON.stringify({
    theme: document.documentElement.dataset.theme,
    bg: cs.getPropertyValue('--bg').trim(),
    kartu: document.querySelectorAll('.card').length,
    tombolTema: !!document.getElementById('theme-toggle'),
  });
})()`);
console.log('awal:', init);

const shot1 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('scratch/shots/theme_light.png', Buffer.from(shot1.data, 'base64'));

// === toggle ke dark ===
await evalJson(`document.getElementById('theme-toggle').click()`);
await sleep(400);
const dark = await evalJson(`(() => {
  const cs = getComputedStyle(document.documentElement);
  const card = document.querySelector('.card');
  const cardBg = getComputedStyle(card).backgroundColor;
  return JSON.stringify({
    theme: document.documentElement.dataset.theme,
    bg: cs.getPropertyValue('--bg').trim(),
    kartuBg: cardBg,
    tersimpan: localStorage.getItem('theme'),
  });
})()`);
console.log('setelah toggle:', dark);

const shot2 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('scratch/shots/theme_dark.png', Buffer.from(shot2.data, 'base64'));

// === reload: tema harus bertahan (persistensi) ===
await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(3000);
const afterReload = await evalJson(`document.documentElement.dataset.theme`);
console.log('setelah reload, tema:', afterReload);

// === buka reader di dark: kontras isi serif ===
await evalJson(`document.querySelector('.card').click()`);
await sleep(2500);
const reader = await evalJson(`(() => {
  const body = document.getElementById('reader-body');
  const p = body.querySelector('p');
  return JSON.stringify({
    tema: document.documentElement.dataset.theme,
    fontIsi: getComputedStyle(body).fontFamily.split(',')[0],
    paragraf: body.querySelectorAll('p').length,
  });
})()`);
console.log('reader dark:', reader);
const shot3 = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('scratch/shots/reader_dark.png', Buffer.from(shot3.data, 'base64'));

chrome.kill();
process.exit(0);
