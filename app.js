// Aplikasi Perpustakaan Ringkasan Buku (offline)
const state = {
  index: null,
  filtered: [],
  shown: 60,
  pageSize: 60,
  sourceFilter: 'all',
  categoryFilter: '',
  sortMode: 'title',
  readTab: 'all',
  query: '',
  fullSearch: false,
  contentCache: new Map(),
  currentBook: null,
  fontSize: Number(localStorage.getItem('fontSize') || 1),
  reading: JSON.parse(localStorage.getItem('reading') || '{}'),
  done: JSON.parse(localStorage.getItem('done') || '[]'),
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SOURCE_LABEL = { f15: 'F15 Library', rofia: 'Rofiatulmaos' };
const validIds = new Set();

// Loader universal: web mem-bypass file .json; APK (asset gzip, tanpa encoding)
// jatuh ke file .gz dan membukanya via DecompressionStream.
async function fetchGzJson(url) {
  try {
    const res = await fetch(url);
    if (res.ok) return await res.json();
  } catch {}
  const res = await fetch(url + '.gz');
  if (!res.ok) throw new Error('gagal memuat ' + url);
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('WebView terlalu lama untuk membuka data terkompresi — perbarui Android System WebView');
  }
  const buf = await res.arrayBuffer();
  if (res.headers.get('Content-Encoding') === 'gzip') {
    const text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text);
  }
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    const text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return JSON.parse(text);
  }
}

// ---------- persistensi status baca ----------
const persistReading = () => localStorage.setItem('reading', JSON.stringify(state.reading));
const persistDone = () => localStorage.setItem('done', JSON.stringify(state.done));

const isDone = (id) => state.done.includes(id);
const getProgress = (id) => state.reading[id]?.pct || 0;

function markDone(id, val) {
  if (val) {
    if (!state.done.includes(id)) state.done.push(id);
    // progress parsial tetap disimpan; akan terpakai jika batal ditandai selesai
  } else {
    state.done = state.done.filter((x) => x !== id);
    state.reading[id] = { pct: state.reading[id]?.pct || 1, updated: Date.now() };
  }
  persistDone();
  persistReading();
  applyFilters();
}

function recordProgress(id, pct) {
  if (isDone(id) || pct <= getProgress(id)) return;
  state.reading[id] = { pct: Math.min(99, Math.round(pct)), updated: Date.now() };
  persistReading();
}

function countValid(list) {
  let n = 0;
  for (const id of list) if (validIds.has(id)) n++;
  return n;
}

function updateCounts() {
  const readingOnly = Object.keys(state.reading).filter((id) => !isDone(id));
  $('#count-reading').textContent = `(${countValid(readingOnly)})`;
  $('#count-done').textContent = `(${countValid(state.done)})`;
}

// ---------- toast ----------
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- init ----------
async function init() {
  state.index = await fetchGzJson('data/index.json');
  for (const b of state.index.books) validIds.add(b.id);
  const s = state.index.stats;
  $('#stat-line').textContent =
    `${s.total.toLocaleString('id-ID')} buku · ${s.totalWords.toLocaleString('id-ID')} kata · offline ✓`;

  // bersihkan status baca untuk buku yang tidak ada lagi
  state.done = state.done.filter((id) => validIds.has(id));
  for (const id of Object.keys(state.reading)) if (!validIds.has(id)) delete state.reading[id];
  persistDone();
  persistReading();

  // chips sumber
  const chips = $('#source-chips');
  const mkChip = (src, label) => {
    const b = document.createElement('button');
    b.className = 'chip' + (src === 'all' ? ' active' : '');
    b.textContent = label;
    b.dataset.src = src;
    chips.appendChild(b);
  };
  mkChip('all', `Semua (${s.total.toLocaleString('id-ID')})`);
  for (const [src, n] of Object.entries(s.bySource)) {
    mkChip(src, `${SOURCE_LABEL[src] || src} (${n.toLocaleString('id-ID')})`);
  }
  chips.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    state.sourceFilter = btn.dataset.src;
    chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === btn));
    applyFilters();
  });

  // kategori
  const catSel = $('#category-select');
  for (const [cat, n] of Object.entries(s.categories)) {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = `${cat} (${n})`;
    catSel.appendChild(opt);
  }
  catSel.addEventListener('change', (e) => {
    state.categoryFilter = e.target.value;
    applyFilters();
  });

  // pencarian
  let debounceTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.query = e.target.value.trim();
      applyFilters();
    }, 250);
  });
  $('#full-search').addEventListener('change', (e) => {
    state.fullSearch = e.target.checked;
    if (state.query) applyFilters();
  });

  // tab status baca
  $('#read-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    state.readTab = btn.dataset.tab;
    $('#read-tabs').querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
    applyFilters();
  });

  // urutan
  $('#sort-select').addEventListener('change', (e) => {
    state.sortMode = e.target.value;
    applyFilters();
  });

  // infinite scroll
  new IntersectionObserver(
    (entries) => { if (entries[0].isIntersecting) renderMore(); },
    { rootMargin: '600px' }
  ).observe($('#sentinel'));

  // tema: siklus light → sepia → dark
  const THEMES = ['light', 'sepia', 'dark'];
  const THEME_LABEL = { light: 'Terang', sepia: 'Sepia', dark: 'Gelap' };
  const setTheme = (t) => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem('theme', t);
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = t === 'dark' ? '#161514' : t === 'sepia' ? '#f4ead8' : '#fbfbfa';
    const btn = $('#theme-toggle');
    if (btn) btn.title = `Tema: ${THEME_LABEL[t]} — ketuk untuk ganti`;
  };
  setTheme(document.documentElement.dataset.theme || 'light');
  $('#theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || 'light';
    const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
    setTheme(next);
    toast(`Tema ${THEME_LABEL[next]}`);
  });

  // reader
  document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeReader));
  $('#font-inc').addEventListener('click', () => setFontSize(state.fontSize + 0.1));
  $('#font-dec').addEventListener('click', () => setFontSize(state.fontSize - 0.1));
  $('#toggle-done').addEventListener('click', () => {
    if (!state.currentBook) return;
    const id = state.currentBook.id;
    markDone(id, !isDone(id));
    toast(isDone(id) ? '✓ Ditandai selesai dibaca' : 'Dikembalikan ke sedang dibaca');
  });
  $('#toc-toggle').addEventListener('click', () => $('#reader-toc').classList.toggle('open'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeReader();
  });

  setFontSize(state.fontSize);
  applyFilters();
}

function setFontSize(v) {
  state.fontSize = Math.min(1.8, Math.max(0.8, Math.round(v * 10) / 10));
  localStorage.setItem('fontSize', String(state.fontSize));
  document.documentElement.style.setProperty('--font-size', state.fontSize + 'rem');
}

// ---------- filter & render ----------
async function applyFilters() {
  if (!state.index) return;
  const s = state.index.stats;
  const books = state.index.books;
  const q = state.query.toLowerCase();
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];

  let list = books;

  if (state.sourceFilter !== 'all') list = list.filter((b) => b.source === state.sourceFilter);
  if (state.categoryFilter) list = list.filter((b) => (b.category || 'Tanpa Kategori') === state.categoryFilter);
  if (state.readTab === 'reading') list = list.filter((b) => !isDone(b.id) && getProgress(b.id) > 0);
  else if (state.readTab === 'done') list = list.filter((b) => isDone(b.id));

  if (tokens.length) {
    if (state.fullSearch) {
      $('#stat-line').textContent = 'Memuat konten untuk pencarian penuh…';
      await loadAllChunks();
      list = list.filter((b) => {
        const hayTitle = `${b.title} ${b.author || ''} ${b.tagline || ''} ${b.excerpt}`.toLowerCase();
        const blocks = state.contentCache.get(b.chunk)?.[b.id] || [];
        const hayBody = blocks.map((x) => (x.text || (x.items || []).join(' '))).join(' ').toLowerCase();
        return tokens.every((t) => hayTitle.includes(t) || hayBody.includes(t));
      });
    } else {
      list = list.filter((b) => {
        const hay = `${b.title} ${b.author || ''} ${b.tagline || ''} ${b.excerpt}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      });
    }
  }

  if (state.readTab === 'reading') {
    list = [...list].sort((a, b) => (state.reading[b.id]?.updated || 0) - (state.reading[a.id]?.updated || 0));
  } else if (state.sortMode === 'words') {
    list = [...list].sort((a, b) => b.words - a.words);
  } else {
    list = [...list].sort((a, b) => a.sortTitle.localeCompare(b.sortTitle, 'id'));
  }

  state.filtered = list;
  $('#grid').innerHTML = '';
  $('#empty').classList.toggle('hidden', list.length > 0);

  const doneCount = countValid(state.done);
  const pct = Math.round((doneCount / s.total) * 100);
  $('#stat-line').textContent =
    `${list.length.toLocaleString('id-ID')} dari ${s.total.toLocaleString('id-ID')} buku · selesai ${doneCount} (${pct}%) · offline ✓`;
  updateCounts();
  renderMore();
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function highlight(text) {
  const q = state.query;
  if (!q || q.length < 3) return esc(text);
  const safe = q.split(/\s+/).filter((w) => w.length >= 3).map(escapeRegex).join('|');
  if (!safe) return esc(text);
  const re = new RegExp(`(${safe})`, 'gi');
  return esc(text).replace(re, '<mark>$1</mark>');
}

function renderMore() {
  const grid = $('#grid');
  const start = grid.children.length;
  if (start >= state.filtered.length) return;
  const end = Math.min(start + state.pageSize, state.filtered.length);
  const frag = document.createDocumentFragment();
  for (let i = start; i < end; i++) {
    const b = state.filtered[i];
    const pct = getProgress(b.id);
    const doneFlag = isDone(b.id);
    const progressHtml = doneFlag
      ? '<div class="card-track done"><div class="card-track-fill" style="width:100%"></div></div>'
      : pct > 0
        ? `<div class="card-track"><div class="card-track-fill" style="width:${pct}%"></div></div>`
        : '';
    const label = doneFlag ? '✓ Selesai' : pct > 0 ? `Dibaca ${pct}%` : '';
    const card = document.createElement('div');
    card.className = 'card' + (doneFlag ? ' is-done' : '');
    card.style.setProperty('--i', i % 12); // stagger halus dalam batch
    card.innerHTML = `
      <div class="card-source"><span class="badge badge-${b.source}">${SOURCE_LABEL[b.source] || b.source}</span></div>
      <h3>${highlight(b.title)}</h3>
      ${b.author ? `<p class="card-author">${esc(b.author)}</p>` : ''}
      ${progressHtml}
      <div class="card-footer"><span>${b.words.toLocaleString('id-ID')} kata</span><span class="status-label">${label}</span></div>`;
    card.addEventListener('click', () => openReader(b));
    frag.appendChild(card);
  }
  grid.appendChild(frag);
  // jika sentinel masih dalam jangkauan viewport (layar besar / hasil sedikit), muat batch berikutnya
  const rect = $('#sentinel').getBoundingClientRect();
  if (grid.children.length < state.filtered.length && rect.top < window.innerHeight + 600) {
    requestAnimationFrame(renderMore);
  }
}

// ---------- konten ----------
async function loadChunk(n) {
  if (state.contentCache.has(n)) return state.contentCache.get(n);
  const obj = await fetchGzJson(`data/content-${n}.json`);
  state.contentCache.set(n, obj);
  return obj;
}

let loadingAll = null;
async function loadAllChunks() {
  if (loadingAll) return loadingAll;
  loadingAll = (async () => {
    const total = state.index.stats.chunks;
    for (let n = 0; n < total; n++) {
      await loadChunk(n);
      $('#stat-line').textContent = `Memuat konten… ${n + 1}/${total}`;
    }
  })();
  return loadingAll;
}

// ---------- reader ----------
function closeReader() {
  $('#reader').classList.add('hidden');
  document.body.style.overflow = '';
  state.currentBook = null;
}

function syncDoneButton() {
  const btn = $('#toggle-done');
  const on = state.currentBook && isDone(state.currentBook.id);
  btn.classList.toggle('on', !!on);
  btn.innerHTML = on
    ? '✓<span class="done-label"> Selesai dibaca</span>'
    : '✓<span class="done-label"> Tandai selesai</span>';
}

async function openReader(book) {
  state.currentBook = book;
  $('#reader').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  $('#reader-title').textContent = book.title;
  $('#reader-meta').textContent =
    [book.author, SOURCE_LABEL[book.source], book.category, book.readMinutes ? `${book.readMinutes} menit baca` : null]
      .filter(Boolean).join(' · ');
  $('#reader-body').innerHTML = '<p style="color:var(--muted)">Memuat…</p>';
  $('#reader-toc').innerHTML = '';
  $('#reader-toc').classList.remove('open');
  $('#reader-progress-bar').style.width = '0%';
  syncDoneButton();

  const chunk = await loadChunk(book.chunk);
  const blocks = chunk[book.id];
  if (!blocks) {
    $('#reader-body').innerHTML = '<p style="color:var(--muted)">Konten tidak ditemukan.</p>';
    return;
  }

  // TOC
  const toc = $('#reader-toc');
  blocks.forEach((blk, idx) => {
    if (blk.type !== 'h2') return;
    const btn = document.createElement('button');
    btn.textContent = blk.text.length > 48 ? blk.text.slice(0, 48) + '…' : blk.text;
    btn.title = blk.text;
    btn.addEventListener('click', () => {
      const el = document.getElementById(`blk-${idx}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    toc.appendChild(btn);
  });

  // render isi
  const body = $('#reader-body');
  body.innerHTML = '';
  blocks.forEach((blk, idx) => {
    if (blk.type === 'h2') {
      const h = document.createElement('h2');
      h.id = `blk-${idx}`;
      h.innerHTML = highlight(blk.text);
      body.appendChild(h);
    } else if (blk.type === 'p') {
      const p = document.createElement('p');
      p.innerHTML = highlight(blk.text);
      body.appendChild(p);
    } else if (blk.type === 'list') {
      const ul = document.createElement('ul');
      for (const item of blk.items) {
        const li = document.createElement('li');
        li.innerHTML = highlight(item);
        ul.appendChild(li);
      }
      body.appendChild(ul);
    }
  });
  body.scrollTo({ top: 0 });

  // progress berdasarkan posisi scroll
  let lastRecord = 0;
  body.addEventListener('scroll', () => {
    const max = body.scrollHeight - body.clientHeight;
    const pct = max > 0 ? Math.round((body.scrollTop / max) * 100) : 100;
    $('#reader-progress-bar').style.width = pct + '%';
    const now = Date.now();
    if (now - lastRecord > 2000) {
      lastRecord = now;
      recordProgress(book.id, pct);
    }
  }, { passive: true });

  // prefetch chunk berikutnya
  const total = state.index.stats.chunks;
  setTimeout(() => { if (book.chunk + 1 < total) loadChunk(book.chunk + 1); }, 1500);
}

init().catch((e) => {
  $('#stat-line').textContent = 'Gagal memuat data: ' + e.message;
  console.error(e);
});
