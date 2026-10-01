// Uji CDP redesign UI: monogram cover, strip lanjut baca, seg pill, badge nav,
// reader hero + resume posisi, tema gelap. Screenshot ke scratch/shots/.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9223;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-ui-'));

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
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
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
fs.mkdirSync('scratch/shots', { recursive: true });
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`scratch/shots/${name}.png`, Buffer.from(s.data, 'base64'));
};

// 1. Library awal
const lib = await evalJson(`JSON.stringify({
  judul: document.querySelector('.topbar-head h1')?.textContent,
  kartu: document.querySelectorAll('.card').length,
  monogramTerisi: [...document.querySelectorAll('.cover-mono')].filter(e => e.textContent.trim()).length,
  segIndikator: getComputedStyle(document.getElementById('read-tabs'), '::before').width,
  dockNav: !!document.querySelector('.bottom-nav .nav-item.active'),
})`);
console.log('library:', lib);
await shot('ui_light_library');

// 2. Buka buku pertama, gulir, tutup → strip lanjut baca muncul
const readerInfo = await evalJson(`(async () => {
  document.querySelector('.card').click();
  await new Promise(r => setTimeout(r, 2500));
  const sc = document.getElementById('reader-scroll');
  sc.scrollTop = sc.scrollHeight * 0.4;
  sc.dispatchEvent(new Event('scroll'));
  await new Promise(r => setTimeout(r, 2500));
  return JSON.stringify({
    heroJudul: document.getElementById('reader-hero-title')?.textContent?.slice(0, 40),
    coverMono: document.getElementById('reader-cover-mono')?.textContent,
    chips: document.querySelectorAll('#reader-chips .meta-chip').length,
    progressLebar: document.getElementById('reader-progress-bar').style.width,
  });
})()`, true);
console.log('reader:', readerInfo);
await shot('ui_reader');
await evalJson(`document.querySelector('[data-close]').click()`);
await sleep(500);

const strip = await evalJson(`JSON.stringify({
  stripTampil: !document.getElementById('continue-section').classList.contains('hidden'),
  kartuLanjut: document.querySelectorAll('.continue-card').length,
})`);
console.log('strip lanjut baca:', strip);
await shot('ui_continue_strip');

// 3. Buka lagi → harus resume dari posisi (~40%)
const resume = await evalJson(`(async () => {
  document.querySelector('.continue-card').click();
  await new Promise(r => setTimeout(r, 2800));
  const sc = document.getElementById('reader-scroll');
  const pct = Math.round((sc.scrollTop / (sc.scrollHeight - sc.clientHeight)) * 100);
  document.querySelector('[data-close]').click();
  return JSON.stringify({ resumePct: pct });
})()`, true);
console.log('resume:', resume);

// 4. Seg "Dibaca" + badge nav
const tabs = await evalJson(`JSON.stringify({
  countReading: document.getElementById('count-reading')?.textContent,
  countDone: document.getElementById('count-done')?.textContent,
  navBadge: document.querySelector('[data-nav-count="reading"]')?.textContent,
})`);
console.log('badge:', tabs);

// 5. Tema gelap
await evalJson(`document.getElementById('theme-toggle').click(); document.getElementById('theme-toggle').click();`);
await sleep(500);
const dark = await evalJson(`document.documentElement.dataset.theme`);
console.log('tema:', dark);
await shot('ui_dark_library');

chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
