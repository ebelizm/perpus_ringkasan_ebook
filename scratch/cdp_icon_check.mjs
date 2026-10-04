// Cek isi visual logo Ringgo: cincin emerald, halaman terang, latar gelap
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9237;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-icon-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, '--window-size=400,400', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 20 && !wsUrl; i++) {
  await sleep(500);
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
}
const ws = new WebSocket(wsUrl);
let msgId = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
await new Promise((r) => (ws.onopen = r));
await send('Page.enable'); await send('Runtime.enable');
const ev = async (expr, aw = false) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: aw })).result?.value;

await send('Page.navigate', { url: 'http://localhost:5173/icons/icon-512.png' });
await sleep(2500);

console.log(await ev(`(async () => {
  const img = document.querySelector('img');
  if (!img) return 'gambar tidak termuat';
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const at = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return d[0] + ',' + d[1] + ',' + d[2]; };
  const s = c.width, cx = s / 2, cy = s / 2;
  const ring = at(cx + Math.round(s * 0.345), cy);           // radial cincin
  const halaman = at(cx + Math.round(s * 0.06), cy);         // halaman buku
  const spine = at(cx - Math.round(s * 0.18), cy);            // punggung
  const bg = at(Math.round(s * 0.03), Math.round(s * 0.03));  // sudut latar
  // proporsi warna
  const px = g.getImageData(0, 0, s, s).data;
  let hijau = 0, terang = 0, gelap = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], gg = px[i + 1], b = px[i + 2];
    if (gg > 140 && gg > r + 30 && gg > b + 20) hijau++;
    else if (r > 200 && gg > 195 && b > 185) terang++;
    else if (r < 60 && gg < 60 && b < 60) gelap++;
  }
  const total = px.length / 4;
  return JSON.stringify({ ukuran: s + 'x' + c.height, ring, halaman, spine, bg,
    persen: { hijau: (hijau / total * 100).toFixed(1), terang: (terang / total * 100).toFixed(1), gelap: (gelap / total * 100).toFixed(1) } });
})()`, true));
ws.close(); chrome.kill();