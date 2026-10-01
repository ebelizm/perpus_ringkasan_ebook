// Diagnostik cepat: stat-line, error JS, apakah applyFilters selesai
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9224;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-diag-'));

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
const events = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === 'Runtime.exceptionThrown') {
    events.push(msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
    events.push('console.error: ' + JSON.stringify(msg.params?.args?.map((a) => a.value || a.description)));
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
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(4000);

const evalJson = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value;

console.log('statLine:', await evalJson(`document.getElementById('stat-line')?.textContent`));
console.log('gridChildren:', await evalJson(`document.getElementById('grid')?.children.length`));
console.log('emptyHidden:', await evalJson(`document.getElementById('empty')?.classList.contains('hidden')`));
console.log('indexLoaded:', await evalJson(`!!window.state?.index`));
console.log('filteredLen:', await evalJson(`window.state?.filtered?.length`));
console.log('JS errors:', events.length ? events.slice(0, 5) : 'tidak ada');

chrome.kill();
process.exit(0);
