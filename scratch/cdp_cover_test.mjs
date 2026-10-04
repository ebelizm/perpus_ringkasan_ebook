// Uji cover asli: ambil saat online → cache IndexedDB → tetap tampil saat offline.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9231;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-cover-'));

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
if (!wsUrl) { console.log('GAGAL konek CDP'); chrome.kill(); process.exit(1); }

const ws = new WebSocket(wsUrl);
let msgId = 0;
const pending = new Map();
const errors = [];
const logs = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params?.exceptionDetails?.exception?.description?.slice(0, 160));
  if (msg.method === 'Runtime.consoleAPICalled' && /error|warn/i.test(msg.params?.type || '')) {
    logs.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 140));
  }
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
await send('Network.enable');

const evalJson = async (expr, awaitPromise = false) =>
  (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })).result?.value;

const probe = `JSON.stringify({
  kartu: document.querySelectorAll('.card-cover').length,
  denganCover: document.querySelectorAll('.card-cover.has-img').length,
  imgSrc: (document.querySelector('.card-cover.has-img .cover-img')||{}).currentSrc ? 'blob' : 'kosong',
  denganDataBook: document.querySelectorAll('.card-cover[data-book]').length,
  terAntre: (typeof coverQueue !== 'undefined') ? coverQueue.length : 'n/a',
  sibuk: (typeof coverBusy !== 'undefined') ? coverBusy : 'n/a',
  terObserv: (typeof coverIO !== 'undefined' && coverIO) ? 'ya' : 'tidak',
  queued: document.querySelectorAll('.card-cover[data-cover-queued]').length,
  done: document.querySelectorAll('.card-cover[data-cover-done]').length,
  monogramTampil: (() => { const c = document.querySelector('.card-cover'); if (!c) return false;
    const b = c.querySelector('.cover-book'); return b ? getComputedStyle(b).opacity !== '0' || !c.classList.contains('has-img') : false; })(),
})`;
const idbCount = `new Promise((res) => { const r = indexedDB.open('covers', 1);
  r.onsuccess = () => { const db = r.result; const t = db.transaction('img','readonly');
    const c = t.objectStore('img').count(); c.onsuccess = () => res(c.result); c.onerror = () => res(-1); };
  r.onerror = () => res(-1); })`;

fs.mkdirSync('scratch/shots', { recursive: true });
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`scratch/shots/${name}.png`, Buffer.from(s.data, 'base64'));
};

// 1) ONLINE — cover harus terambil & dicache.
// Cari judul yang memang punya padanan di Open Library agar hasil tidak ambigu.
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(2500); // jangan biarkan grid penuh memenuhi antrean lookup
await evalJson(`(() => { const s = document.getElementById('search'); s.value = 'Clash of Civilizations';
  s.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
await sleep(14000);
const on = JSON.parse(await evalJson(probe));
const cached = await evalJson(idbCount, true);
console.log(`ONLINE  : kartu=${on.kartu} denganCover=${on.denganCover} imgSrc=${on.imgSrc} | entriIDB=${cached}`);
console.log(`  detail: dataBook=${on.denganDataBook} terAntre=${on.terAntre} sibuk=${on.sibuk} terObserv=${on.terObserv} queued=${on.queued} done=${on.done}`);
if (logs.length) console.log('console :', logs.slice(0, 6).join(' || '));
await shot('cover-online');

// 2) OFFLINE — kartu tetap tampil, cover dari cache muncul, tak ada crash
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await send('Page.reload');
await sleep(2500);
await evalJson(`(() => { const s = document.getElementById('search'); s.value = 'Clash of Civilizations';
  s.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
await sleep(6000);
const off = JSON.parse(await evalJson(probe));
console.log(`OFFLINE : kartu=${off.kartu} denganCover=${off.denganCover} monogramOk=${off.monogramTampil}`);
await shot('cover-offline');

// 3) lecteur: cover juga dipasang di hero reader
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await send('Page.reload');
await sleep(2500);
await evalJson(`(() => { const s = document.getElementById('search'); s.value = 'Clash of Civilizations';
  s.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
await sleep(3000);
await evalJson(`document.querySelector('.card').click(); 'ok'`);
await sleep(3000);
const rd = JSON.parse(await evalJson(`JSON.stringify({
  readerCover: !!document.querySelector('#reader-cover'),
  hasImg: document.querySelector('#reader-cover').classList.contains('has-img'),
})`));
console.log(`READER  : ada=${rd.readerCover} denganCover=${rd.hasImg}`);

console.log(errors.length ? 'JS errors: ' + errors.join(' | ') : 'Tanpa error JS ✓');
ws.close();
chrome.kill();