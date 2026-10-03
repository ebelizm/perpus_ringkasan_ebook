// Verifikasi responsif: sapu viewport, cek grid/sticky/overflow + screenshot.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9229;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-resp-'));

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
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params?.exceptionDetails?.exception?.description?.slice(0, 200));
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
fs.mkdirSync('scratch/shots', { recursive: true });

const evalJson = async (expr, awaitPromise = false) =>
  (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise })).result?.value;
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(`scratch/shots/${name}.png`, Buffer.from(s.data, 'base64'));
};

const VIEWPORTS = [
  { name: 'hp-kecil', w: 320, h: 680 },
  { name: 'hp', w: 390, h: 844 },
  { name: 'hp-besar', w: 460, h: 900 },
  { name: 'tablet', w: 768, h: 1024 },
  { name: 'desktop', w: 1280, h: 800 },
];

for (const vp of VIEWPORTS) {
  await send('Emulation.setDeviceMetricsOverride', { width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: vp.w < 900 });
  await send('Page.navigate', { url: 'http://localhost:5173/' });
  await sleep(3000);
  const r = await evalJson(`JSON.stringify({
    vw: innerWidth,
    kolom: getComputedStyle(document.getElementById('grid')).gridTemplateColumns.split(' ').length,
    topbarH: document.querySelector('.topbar').offsetHeight,
    topbarVar: getComputedStyle(document.documentElement).getPropertyValue('--topbar-h').trim(),
    filterbarTop: getComputedStyle(document.querySelector('.filterbar')).top,
    scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    kartu: document.querySelectorAll('.card').length,
    navMaxW: getComputedStyle(document.querySelector('.bottom-nav')).maxWidth,
  })`);
  const d = JSON.parse(r);
  // scroll untuk menguji sticky offset nyata
  await evalJson(`window.scrollTo(0, 400); 'ok'`);
  await sleep(400);
  const sticky = await evalJson(`JSON.stringify({
    filterY: Math.round(document.querySelector('.filterbar').getBoundingClientRect().top),
    topbarY: Math.round(document.querySelector('.topbar').getBoundingClientRect().bottom),
  })`);
  const st = JSON.parse(sticky);
  const gapOk = Math.abs(st.filterY - st.topbarY) <= 1;
  console.log(
    `${vp.name} (${vp.w}x${vp.h}): kolom=${d.kolom} kartu=${d.kartu} | --topbar-h=${d.topbarVar} topbar=${d.topbarH} | ` +
    `sticky: filterY=${st.filterY} vs topbarBawah=${st.topbarY} ${gapOk ? 'OK' : 'GAGAL'} | ` +
    `overflowX=${d.scrollX} ${d.scrollX <= 0 ? 'OK' : 'GAGAL'} | navMax=${d.navMaxW}`
  );
  await evalJson(`window.scrollTo(0, 0); 'ok'`);
  await sleep(300);
  await shot(`resp-${vp.name}`);
}

// buka reader di hp: pastikan action bar & toc terlihat
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(3000);
await evalJson(`document.querySelector('.card').click(); 'ok'`);
await sleep(1500);
const reader = await evalJson(`JSON.stringify({
  terbuka: !document.getElementById('reader').classList.contains('hidden'),
  tocToggle: getComputedStyle(document.getElementById('toc-toggle')).display,
  actionsH: document.querySelector('.reader-actions').offsetHeight,
  heroVisible: document.getElementById('reader-hero-title').textContent.length > 0,
})`);
const rd = JSON.parse(reader);
console.log(`reader@390px: terbuka=${rd.terbuka} tocToggle='${rd.tocToggle}' actionsH=${rd.actionsH} hero='${rd.heroVisible}'`);
await shot('resp-reader');

console.log(errors.length ? 'JS errors: ' + errors.join(' | ') : 'Tanpa error JS ✓');
ws.close();
chrome.kill();
