// Debug cover: apakah URL ditemukan, blob ter-cache, dan img benar-benar load?
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9243;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-cd-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 20 && !wsUrl; i++) {
  await sleep(500);
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
}
const ws = new WebSocket(wsUrl);
let id = 0; const p = new Map(); const logs = []; const netFail = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160));
  if (m.method === 'Network.loadingFailed') netFail.push(m.params.errorText + ' ' + (m.params.type || ''));
  if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); }
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
const ev = async (e, aw = false) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: aw })).result?.value;

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(2500);
await ev(`(() => { const s = document.getElementById('search'); s.value = 'Clash of Civilizations';
  s.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
await sleep(15000);

console.log('CARI URL :', await ev(`(async () => {
  const b = state.byId.get(state.filtered[0].id);
  const url = await findCoverUrl(b);
  return JSON.stringify({ judul: b.title, url });
})()`, true));
console.log('IDB      :', await ev(`new Promise((res) => { const r = indexedDB.open('covers', 1);
  r.onsuccess = () => { const t = r.result.transaction('img','readonly').objectStore('img');
    const k = t.get(state.filtered[0].id);
    k.onsuccess = () => res(JSON.stringify(k.result ? { ok: k.result.ok, nocache: !!k.result.nocache, url: k.result.url, blob: k.result.blob ? k.result.blob.size + 'b/' + k.result.blob.type : null } : null));
    k.onerror = () => res('err'); };
  r.onerror = () => res('db-err'); })`, true));
console.log('DOM      :', await ev(`JSON.stringify((() => {
  const c = document.querySelector('.card-cover');
  const img = c.querySelector('.cover-img');
  return { cls: c.className, dataBook: c.dataset.book, coverDone: c.dataset.coverDone,
    imgSrc: img.src.slice(0, 40), natural: img.naturalWidth + 'x' + img.naturalHeight,
    complete: img.complete, imgOpacity: getComputedStyle(img).opacity,
    rect: JSON.stringify(c.getBoundingClientRect().toJSON()) };
})())`));
console.log('NETFAIL  :', [...new Set(netFail)].slice(0, 6).join(' | ') || 'tidak ada');
console.log('LOGS     :', logs.slice(0, 8).join(' || ') || 'tidak ada');
ws.close(); chrome.kill();