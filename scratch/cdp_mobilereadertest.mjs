// Uji reader di viewport mobile via CDP + screenshot
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
// emulate device mobile
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(3500);

// buka buku pertama
await send('Runtime.evaluate', { expression: "document.querySelector('.card').click()" });
await sleep(2500);

const r = await send('Runtime.evaluate', { expression: `(() => {
  const head = document.querySelector('.reader-head');
  const h2 = document.querySelector('.reader-head-info h2');
  const meta = document.querySelector('.reader-head-info p');
  const toggle = document.getElementById('toc-toggle');
  const toc = document.getElementById('reader-toc');
  const done = document.getElementById('toggle-done');
  const body = document.getElementById('reader-body');
  const vis = (el) => getComputedStyle(el).display !== 'none';
  return JSON.stringify({
    tinggiHeader: Math.round(head.getBoundingClientRect().height),
    judulTerpotong: h2.scrollWidth > h2.clientWidth + 1,
    metaTerpotong: meta.scrollWidth > meta.clientWidth + 1,
    toggleTampil: vis(toggle),
    tocTertutup: !vis(toc),
    lebarTombolDone: Math.round(done.getBoundingClientRect().width),
    tinggiKontenTerlihat: Math.round(body.clientHeight),
    viewport: window.innerHeight,
  });
})()` });
console.log('=== UKURAN READER (390px mobile) ===');
console.log(r.result?.value);

// tes toggle TOC
await send('Runtime.evaluate', { expression: "document.getElementById('toc-toggle').click()" });
await sleep(300);
const r2 = await send('Runtime.evaluate', { expression: "getComputedStyle(document.getElementById('reader-toc')).display" });
console.log('TOC setelah toggle:', r2.result?.value);

// screenshot
fs.mkdirSync('scratch/shots', { recursive: true });
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('scratch/shots/reader_mobile.png', Buffer.from(shot.data, 'base64'));
console.log('screenshot: scratch/shots/reader_mobile.png');

chrome.kill();
process.exit(0);
