// Audit semua elemen <button>: adakah yang warnanya tetap UA default (hitam)
// alih-alih mewarisi --text? Ini bug yang sama seperti kartu lanjut baca.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9334;
const chrome = spawn(
  process.env.CHROME_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [`--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu', '--no-first-run',
   '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'cdp-')), 'about:blank'],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function targets() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); if (r.ok) return r.json(); } catch {}
    await sleep(250);
  }
  throw new Error('Chrome tidak merespons');
}
let id = 0;
function connect(u) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(u); const pending = new Map();
    ws.onopen = () => resolve({
      send(method, params = {}) {
        const i = ++id;
        return new Promise((res, rej) => { pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
      },
      close: () => ws.close(),
    });
    ws.onerror = reject;
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id); pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    };
  });
}
const page = (await targets()).find((t) => t.type === 'page');
const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Page.navigate', { url: 'http://localhost:5173/' });
await sleep(3000);
const evaluate = async (expr) => {
  const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

// seed status baca + buka reader supaya semua tombol ter-audit
await evaluate(`(() => {
  const books = (state.index?.books || []).slice(0, 3);
  const reading = {};
  books.forEach((b, i) => { reading[b.id] = { pct: [62, 30, 88][i], updated: Date.now() }; });
  state.reading = reading; persistReading(); renderContinue();
  return true;
})()`);
await sleep(600);

const audit = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('button')) {
    const cs = getComputedStyle(el);
    const own = (el.innerText || '').trim().slice(0, 20);
    out.push({
      cls: el.className || '(tanpa class)',
      color: cs.color,
      text: own,
    });
  }
  return out;
})()`;

const report = {};
for (const theme of ['light', 'dark']) {
  await evaluate(`(() => { document.documentElement.dataset.theme = ${JSON.stringify(theme)}; return true; })()`);
  await sleep(300);
  report[theme] = await evaluate(audit);
}

const expect = { light: 'rgb(0, 0, 0)', dark: 'rgb(236, 233, 226)' };
for (const theme of ['light', 'dark']) {
  console.log(`== ${theme} ==`);
  const seen = new Map();
  for (const b of report[theme]) {
    const k = b.cls + '|' + b.color;
    if (!seen.has(k)) seen.set(k, b);
  }
  for (const b of seen.values()) {
    console.log(`  ${b.color.padEnd(22)} ${b.cls.padEnd(34)} "${b.text}"`);
  }
}
cdp.close(); chrome.kill();
