// Uji CDP: buka harness scrolltest di tab Chrome headless, tunggu hasilnya
import { execSync, spawn } from 'child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

try { execSync('taskkill /F /IM chrome.exe', { shell: 'cmd.exe', stdio: 'ignore' }); } catch {}
await new Promise((r) => setTimeout(r, 1500));

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--remote-debugging-port=9222',
  '--window-size=900,900',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ambil ws url target
let wsUrl = null;
for (let i = 0; i < 20 && !wsUrl; i++) {
  await sleep(500);
  try {
    const res = await fetch('http://127.0.0.1:9222/json');
    const tabs = await res.json();
    const tab = tabs.find((t) => t.type === 'page');
    if (tab) wsUrl = tab.webSocketDebuggerUrl;
  } catch {}
}
if (!wsUrl) { console.log('GAGAL: tidak bisa konek CDP'); chrome.kill(); process.exit(1); }

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

// buka harness
await send('Page.navigate', { url: 'http://localhost:5173/scratch/scrolltest.html' });

// poll hasil dari #out
let final = null;
for (let i = 0; i < 40; i++) {
  await sleep(1000);
  const r = await send('Runtime.evaluate', { expression: "document.getElementById('out').textContent" });
  const text = r.result?.value || '';
  if (text.includes('FINAL')) { final = text; break; }
}

console.log(final || 'TIMEOUT: harness tidak selesai');
chrome.kill();
process.exit(0);
