// Ukur warna nyata kartu "lanjutkan membaca" per tema: bg kartu, teks judul,
// teks persen, bar progres, dan kontras teks terhadap latar kartu.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9333;
const URL_APP = 'http://localhost:5173/';

const chrome = spawn(
  process.env.CHROME_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  [
    `--remote-debugging-port=${PORT}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'cdp-')),
    'about:blank',
  ],
  { stdio: 'ignore', detached: false },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpTargets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome tidak merespons');
}

let msgId = 0;
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    ws.onopen = () =>
      resolve({
        send(method, params = {}, sessionId) {
          const id = ++msgId;
          return new Promise((res, rej) => {
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params, sessionId }));
          });
        },
        close: () => ws.close(),
      });
    ws.onerror = reject;
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      }
    };
  });
}

const targets = await cdpTargets();
const page = targets.find((t) => t.type === 'page');
const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Page.navigate', { url: URL_APP });
await sleep(2500);

const evaluate = async (expr) => {
  const r = await cdp.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

// app.js dimuat sebagai script klasik, jadi `state` + renderContinue() adalah global.
await evaluate(`(() => {
  const books = (state.index?.books || []).slice(0, 4);
  const reading = {};
  books.forEach((b, i) => {
    reading[b.id] = { pct: [62, 30, 88, 12][i], updated: Date.now() - i * 86400000 };
  });
  state.reading = reading;
  persistReading();
  renderContinue();
  return { ids: books.map((b) => b.id), titles: books.map((b) => b.title) };
})()`);
console.error('seed:', JSON.stringify(await evaluate('({ cards: document.querySelectorAll(".continue-card").length })')));
await sleep(800);

const probe = `(() => {
  const parse = (c) => {
    const m = c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.01) return c;
      n = n.parentElement;
    }
    return parse(getComputedStyle(document.body).backgroundColor);
  };
  const out = { theme: document.documentElement.dataset.theme, cards: [] };
  for (const el of document.querySelectorAll('.continue-card')) {
    const cs = getComputedStyle(el);
    const bg = bgOf(el);
    const title = el.querySelector('strong');
    const pct = el.querySelector('small');
    const bar = el.querySelector('.cbar');
    const fill = bar && bar.querySelector('i');
    out.cards.push({
      title: title ? title.textContent.slice(0, 24) : null,
      cardBg: cs.backgroundColor,
      border: cs.borderTopColor,
      titleColor: title ? getComputedStyle(title).color : null,
      titleRatio: title ? +ratio(parse(getComputedStyle(title).color), bg).toFixed(2) : null,
      pctColor: pct ? getComputedStyle(pct).color : null,
      pctRatio: pct ? +ratio(parse(getComputedStyle(pct).color), bg).toFixed(2) : null,
      barBg: bar ? getComputedStyle(bar).backgroundColor : null,
      barFill: fill ? getComputedStyle(fill).backgroundColor : null,
    });
  }
  const stripBg = bgOf(document.querySelector('.continue-strip') || document.body);
  out.cardVsPage = out.cards[0]
    ? +ratio(parse(out.cards[0].cardBg), stripBg).toFixed(2) : null;
  out.stripBg = document.querySelector('.continue-strip')
    ? getComputedStyle(document.querySelector('.continue-strip')).backgroundColor : null;
  return out;
})()`;

const themes = ['light', 'sepia', 'dark'];
const results = {};
results.chain = await evaluate(`(() => {
  const el = document.querySelector('.continue-card');
  if (!el) return null;
  const chain = [];
  let n = el;
  while (n && n.nodeType === 1) {
    chain.push({ sel: n.tagName + (n.className ? '.' + String(n.className).split(' ').join('.') : ''), color: getComputedStyle(n).color });
    n = n.parentElement;
  }
  const gridCard = document.querySelector('.card');
  return {
    chain,
    tagIsButton: el.tagName,
    // pembanding: kartu grid bukan <button>?
    gridTag: gridCard ? gridCard.tagName : null,
    gridTitleColor: (() => {
      const t = document.querySelector('.card h3');
      return t ? getComputedStyle(t).color : null;
    })(),
  };
})()`);
for (const theme of themes) {
  await evaluate(`(() => {
    document.documentElement.dataset.theme = ${JSON.stringify(theme)};
    localStorage.setItem('ringgo:theme', ${JSON.stringify(theme)});
    return true;
  })()`);
  await sleep(400);
  results[theme] = await evaluate(probe);
}

// Card utama di grid juga, sebagai pembanding
await evaluate(`(() => { document.documentElement.dataset.theme='dark'; return true; })()`);
await sleep(300);
results.darkGridCard = await evaluate(`(() => {
  const el = document.querySelector('.card');
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { cardBg: cs.backgroundColor, border: cs.borderTopColor };
})()`);

console.log(JSON.stringify(results, null, 2));
cdp.close();
chrome.kill();
writeFileSync('scratch/continue_color_report.json', JSON.stringify(results, null, 2));
process.exit(0);
