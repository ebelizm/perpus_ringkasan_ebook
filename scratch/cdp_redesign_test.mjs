// Uji asap redesign via CDP + screenshot light/dark/mobile
import { spawn } from 'child_process';
import fs from 'fs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--remote-debugging-port=9223',
  '--user-data-dir=' + process.env.TEMP + '/buffy-chrome-test',
  '--window-size=390,844',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wsUrl = null;
for (let i = 0; i < 20 && !wsUrl; i++) {
  await sleep(500);
  try {
    const res = await fetch('http://127.0.0.1:9223/json');
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
  if (r.exceptionDetails) return { ERROR: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
  return r.result?.value;
};

const results = [];
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

fs.mkdirSync('scratch/shots', { recursive: true });
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('scratch/shots/' + name, Buffer.from(s.data, 'base64'));
};

// 1. render awal
const init = await evalJson(`JSON.stringify({
  theme: document.documentElement.dataset.theme,
  cards: document.querySelectorAll('.card').length,
  covers: document.querySelectorAll('.card-cover').length,
  nav: !!document.querySelector('.bottom-nav'),
  navItems: document.querySelectorAll('.nav-item').length,
  skeletons: document.querySelectorAll('.skeleton').length,
})`);
const ini = JSON.parse(init);
check('kartu dirender', ini.cards > 0, `${ini.cards} kartu`);
check('cover di kartu', ini.covers === ini.cards && ini.covers > 0);
check('bottom nav ada', ini.nav && ini.navItems === 3);
check('skeleton bersih', ini.skeletons === 0);
await shot('redesign_light_home.png');

// 2. bottom nav → tab selesai
await evalJson(`document.querySelector('.nav-item[data-nav="done"]').click()`);
await sleep(400);
const navState = JSON.parse(await evalJson(`JSON.stringify({
  tab: (document.querySelector('.seg-btn.active')||{}).dataset?.tab,
  navActive: (document.querySelector('.nav-item.active')||{}).dataset?.nav,
})`));
check('nav→done sinkron', navState.tab === 'done' && navState.navActive === 'done', JSON.stringify(navState));

// 3. kembali ke perpustakaan, buka buku pertama
await evalJson(`document.querySelector('.nav-item[data-nav="library"]').click()`);
await sleep(400);
await evalJson(`document.querySelector('.card').click()`);
await sleep(1500);
const reader = JSON.parse(await evalJson(`JSON.stringify({
  open: !document.getElementById('reader').classList.contains('hidden'),
  title: document.getElementById('reader-title').textContent,
  bodyChars: document.getElementById('reader-body').textContent.length,
  actionbar: !!document.querySelector('.reader-actions'),
  doneLabel: (document.querySelector('.done-label')||{}).textContent,
})`));
check('reader terbuka', reader.open && reader.bodyChars > 100, reader.title);
check('action bar reader', reader.actionbar);
check('label tombol selesai', reader.doneLabel === 'Tandai selesai', reader.doneLabel);
await shot('redesign_reader.png');

// 4. tandai selesai → confetti + label berubah
await evalJson(`document.getElementById('toggle-done').click()`);
await sleep(300);
const afterDone = JSON.parse(await evalJson(`JSON.stringify({
  confetti: document.querySelectorAll('.confetti').length,
  label: (document.querySelector('.done-label')||{}).textContent,
  on: document.getElementById('toggle-done').classList.contains('on'),
})`));
check('confetti muncul', afterDone.confetti > 0);
check('tombol jadi "Selesai dibaca"', afterDone.on && afterDone.label === 'Selesai dibaca', afterDone.label);
await shot('redesign_reader_done.png');
await evalJson(`document.querySelector('.icon-btn[data-close]').click()`);
await sleep(400);

// 5. empty state + reset CTA
await evalJson(`
  const s = document.getElementById('search');
  s.value = 'zzzqwxjklmcmcpertama';
  s.dispatchEvent(new Event('input', { bubbles: true }));
`);
await sleep(700);
const empty1 = JSON.parse(await evalJson(`JSON.stringify({
  visible: !document.getElementById('empty').classList.contains('hidden'),
  cta: !!document.getElementById('empty-reset'),
})`));
check('empty state tampil', empty1.visible);
check('CTA reset ada', empty1.cta);
await shot('redesign_empty.png');
await evalJson(`document.getElementById('empty-reset').click()`);
await sleep(700);
const empty2 = JSON.parse(await evalJson(`JSON.stringify({
  visible: document.getElementById('empty').classList.contains('hidden'),
  query: document.getElementById('search').value,
  cards: document.querySelectorAll('.card').length,
})`));
check('reset bekerja', empty2.visible && empty2.query === '' && empty2.cards > 0);

// 6. tema dark
await evalJson(`document.getElementById('theme-toggle').click()`);
await sleep(500);
await evalJson(`document.getElementById('theme-toggle').click()`);
await sleep(500);
await shot('redesign_dark_home.png');
const dark = await evalJson(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`);
check('dark theme aktif', dark === '#141311', dark);

console.log(results.join('\n'));
const fails = results.filter((r) => r.startsWith('FAIL')).length;
console.log(fails === 0 ? 'SEMUA PASS' : `${fails} GAGAL`);
ws.close();
chrome.kill();
process.exit(fails === 0 ? 0 : 1);
