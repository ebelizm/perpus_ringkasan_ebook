// Uji semua "state" redesigned: cover, continue-strip, done, empty, tema,
// ukuran target sentuh, dan hierarki tipografi.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9239;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-state-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--window-size=390,844', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 20 && !wsUrl; i++) {
  await sleep(500);
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
}
const ws = new WebSocket(wsUrl);
let msgId = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params?.exceptionDetails?.exception?.description?.slice(0, 180));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
});
await new Promise((r) => (ws.onopen = r));
await send('Page.enable'); await send('Runtime.enable');
fs.mkdirSync('scratch/shots', { recursive: true });
const ev = async (e, aw = false) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: aw })).result?.value;
const shot = async (n) => fs.writeFileSync(`scratch/shots/${n}.png`, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// --- A. empty state (query mustahil) ---
await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(2500);
await ev(`(() => { const s = document.getElementById('search'); s.value = 'zzzqqqxyz';
  s.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
await sleep(900);
console.log('EMPTY  :', await ev(`JSON.stringify({
  tampil: !document.getElementById('empty').classList.contains('hidden'),
  saran: [...document.querySelectorAll('#empty-sugg button')].map(b => b.textContent),
  ctaH: document.getElementById('empty-reset').offsetHeight,
  overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth })`));
await shot('ui-empty');
// klik saran pertama → harus mengembalikan hasil
await ev(`document.querySelector('#empty-sugg button').click(); 'ok'`);
await sleep(800);
console.log('SARAAN :', await ev(`JSON.stringify({
  kartu: document.querySelectorAll('.card').length,
  empty: !document.getElementById('empty').classList.contains('hidden'),
  kat: document.getElementById('category-select').value })`));

// --- B. simulate baca: 3 buku progress + 1 selesai → continue-strip ---
await ev(`(() => {
  localStorage.setItem('reading', JSON.stringify({
    ${JSON.stringify(0)}: { pct: 62, updated: Date.now() },
  }));
  const books = state.filtered.slice(0, 3);
  const m = {};
  books.forEach((b, i) => { m[b.id] = { pct: [62, 30, 88][i], updated: Date.now() - i * 1000 }; });
  localStorage.setItem('reading', JSON.stringify(m));
  localStorage.setItem('done', JSON.stringify([state.filtered[4].id]));
  return 'ok'; })()`);
await send('Page.reload'); await sleep(3000);
console.log('STRIP  :', await ev(`JSON.stringify({
  tampil: !document.getElementById('continue-section').classList.contains('hidden'),
  kartu: document.querySelectorAll('.continue-card').length,
  cover: document.querySelectorAll('.continue-cover').length,
  baris: [...document.querySelectorAll('.cbar i')].map(i => i.style.width),
  countReading: document.getElementById('count-reading').textContent,
  countDone: document.getElementById('count-done').textContent })`));
await shot('ui-continue');

// --- C. tab "Dibaca" & "Selesai" ---
await ev(`document.querySelector('.nav-item[data-nav="done"]').click(); 'ok'`); await sleep(700);
console.log('SELESAI:', await ev(`JSON.stringify({
  kartu: document.querySelectorAll('.card').length,
  selesaiCard: document.querySelectorAll('.card.is-done').length,
  ring: document.querySelectorAll('.cover-ring.done').length })`));
await shot('ui-done');
await ev(`document.querySelector('.nav-item[data-nav="library"]').click(); 'ok'`); await sleep(600);

// --- D. target sentuh ≥44px ---
console.log('TAP    :', await ev(`JSON.stringify((() => {
  const sel = ['.icon-btn','.search-wrap','.full-check','.done-btn','.empty-btn','.nav-item','.chip','.seg-btn','.continue-card','.reader-actions .icon-btn'];
  const bad = [];
  for (const s of sel) for (const el of document.querySelectorAll(s)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.height < 44 || r.width < 44) bad.push(s + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return { gagal: [...new Set(bad)] };
})())`));

// --- E. tipografi: jumlah ukuran & bobot ---
console.log('TIPO   :', await ev(`JSON.stringify((() => {
  const set = new Set(), w = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!el.textContent.trim() || el.children.length > 0) continue;
    const cs = getComputedStyle(el);
    set.add(cs.fontSize + '/' + cs.fontFamily.split(',')[0].replace(/["']/g, ''));
    w.add(cs.fontWeight);
  }
  return { ukuran: [...set], bobot: [...w].sort() };
})())`));

// --- F. brand mark + tema cycling ---
await shot('ui-library');
for (const t of ['sepia', 'dark']) {
  await ev(`(() => { localStorage.setItem('theme', '${t}'); document.documentElement.dataset.theme='${t}'; return 'ok'; })()`);
  await sleep(400);
  console.log('TEMA ' + t + ':', await ev(`JSON.stringify({
    bg: getComputedStyle(document.body).backgroundColor,
    brand: !!document.querySelector('.brand-mark svg'),
    dock: getComputedStyle(document.querySelector('.bottom-nav')).borderRadius })`));
  await shot('ui-theme-' + t);
}

// --- G. spacing: nilai ganjil di token utama ---
console.log('GRID8  :', await ev(`JSON.stringify((() => {
  const tok = ['--sp-1','--sp-2','--sp-3','--sp-4','--sp-5','--sp-6','--sp-7','--tap'];
  return tok.map(t => t + '=' + getComputedStyle(document.documentElement).getPropertyValue(t).trim()).join(' ');
})())`));

console.log(errors.length ? 'JS errors: ' + errors.join(' | ') : 'Tanpa error JS ✓');
ws.close(); chrome.kill();