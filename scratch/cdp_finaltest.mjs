// Uji CDP: siklus 3 tema (light→sepia→dark), persistensi, reader, pencarian
import { execSync, spawn } from 'child_process';
import fs from 'fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

try { execSync('taskkill /F /IM chrome.exe', { shell: 'cmd.exe', stdio: 'ignore' }); } catch {}
await new Promise((r) => setTimeout(r, 1500));

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--remote-debugging-port=9222',
  '--window-size=390,844', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 20 && !wsUrl; i++) {
  await sleep(500);
  try {
    const res = await fetch('http://127.0.0.1:9222/json');
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

const evalJson = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value;
fs.mkdirSync('scratch/shots', { recursive: true });

// --- info awal + loader gzip ---
const init = await evalJson(`(() => {
  const cs = getComputedStyle(document.documentElement);
  return JSON.stringify({
    tema: document.documentElement.dataset.theme,
    bg: cs.getPropertyValue('--bg').trim(),
    kartu: document.querySelectorAll('.card').length,
    tombolTema: !!document.getElementById('theme-toggle'),
  });
})()`);
console.log('awal:', init);

// --- siklus tema 3x, cek bg berubah + tersimpan ---
const bgOf = async () => evalJson(`getComputedStyle(document.body).backgroundColor`);
const seen = [];
for (let k = 0; k < 3; k++) {
  await evalJson(`document.getElementById('theme-toggle').click()`);
  await sleep(350);
  seen.push(await evalJson(`document.documentElement.dataset.theme + ':' + await 0 || getComputedStyle(document.body).backgroundColor`));
  const theme = await evalJson(`document.documentElement.dataset.theme`);
  const bg = await evalJson(`getComputedStyle(document.body).backgroundColor`);
  const saved = await evalJson(`localStorage.getItem('theme')`);
  seen.push(`${theme} bg=${bg} tersimpan=${saved}`);
  if (theme === 'sepia') {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('scratch/shots/theme_sepia.png', Buffer.from(s.data, 'base64'));
  }
  if (theme === 'dark') {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('scratch/shots/theme_dark2.png', Buffer.from(s.data, 'base64'));
  }
}
console.log('siklus tema:');
for (const s of seen) if (s) console.log(' -', s);

// --- persistensi setelah reload ---
await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(3000);
console.log('setelah reload tema =', await evalJson(`document.documentElement.dataset.theme`), '(harus dark)');

// --- buka reader, cek serif + TOC + progress ---
await evalJson(`document.querySelector('.card').click()`);
await sleep(2500);
const reader = await evalJson(`(() => {
  const body = document.getElementById('reader-body');
  const done = document.getElementById('toggle-done');
  return JSON.stringify({
    fontIsi: getComputedStyle(body).fontFamily.split(',')[0],
    paragraf: body.querySelectorAll('p').length,
    h2: body.querySelectorAll('h2').length,
    lebarTombolDone: Math.round(done.getBoundingClientRect().width),
    tinggiAreaBaca: Math.round(body.clientHeight),
  });
})()`);
console.log('reader:', reader);
const s = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('scratch/shots/reader_final.png', Buffer.from(s.data, 'base64'));

// --- tutup reader, tes pencarian ---
await evalJson(`document.querySelector('[data-close]').click()`);
await sleep(300);
await evalJson(`const i=document.getElementById('search'); i.value='habits'; i.dispatchEvent(new Event('input',{bubbles:true}))`);
await sleep(1200);
const search = await evalJson(`document.querySelectorAll('.card').length + ' hasil untuk "habits"'`);
console.log('pencarian:', search);

chrome.kill();
process.exit(0);
