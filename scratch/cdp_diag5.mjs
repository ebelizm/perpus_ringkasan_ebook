// Diagnostik interaksi: scroll reader, recordProgress, siklus tema
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9225;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-diag5-'));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=390,844', 'about:blank',
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
if (!wsUrl) { console.log('GAGAL konek CDP'); chrome.kill(); process.exit(1); }

const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params?.exceptionDetails?.exception?.description?.slice(0, 300));
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++msgId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => (ws.onopen = r));
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(3500);

const evalJson = async (expr, awaitPromise = false) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })).result?.value;

// buka reader lewat kartu, cek geometri scroll
const open = await evalJson(`(async () => {
  document.querySelector('.card').click();
  await new Promise(r => setTimeout(r, 3000));
  const sc = document.getElementById('reader-scroll');
  return JSON.stringify({
    judul: document.getElementById('reader-hero-title')?.textContent?.slice(0, 30),
    scrollHeight: sc.scrollHeight,
    clientHeight: sc.clientHeight,
    bodyParagraf: document.getElementById('reader-body').querySelectorAll('p').length,
  });
})()`, true);
console.log('open:', open);

// gulir & tunggu recordProgress (throttle 2s)
const scrollRes = await evalJson(`(async () => {
  const sc = document.getElementById('reader-scroll');
  sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * 0.5;
  await new Promise(r => setTimeout(r, 2600));
  return JSON.stringify({
    scrollTop: sc.scrollTop,
    barWidth: document.getElementById('reader-progress-bar').style.width,
    reading: localStorage.getItem('reading'),
  });
})()`, true);
console.log('scroll:', scrollRes);

// tutup → strip?
await evalJson(`document.querySelector('[data-close]').click()`);
await sleep(600);
console.log('strip:', await evalJson(`JSON.stringify({
  tampil: !document.getElementById('continue-section').classList.contains('hidden'),
  kartu: document.querySelectorAll('.continue-card').length,
})`));

// tema: klik satu per satu
let t0 = await evalJson(`document.documentElement.dataset.theme`);
await evalJson(`document.getElementById('theme-toggle').click()`);
await sleep(300);
let t1 = await evalJson(`document.documentElement.dataset.theme`);
await evalJson(`document.getElementById('theme-toggle').click()`);
await sleep(300);
let t2 = await evalJson(`document.documentElement.dataset.theme`);
console.log('tema:', t0, '→', t1, '→', t2);

console.log('errors:', errors.length ? errors.slice(0, 3) : 'tidak ada');
chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
