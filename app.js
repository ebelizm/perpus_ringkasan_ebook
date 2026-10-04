// Ringgo Book — aplikasi ringkasan buku (offline)
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
const READING_RESET_KEY = 'readingResetAt';

// offset sticky filterbar mengikuti tinggi topbar nyata — aman terhadap
// font-scale Android, zoom, dan wrap teks di berbagai perangkat
const syncTopbarH = () =>
  document.documentElement.style.setProperty('--topbar-h', document.querySelector('.topbar').offsetHeight + 'px');
syncTopbarH();
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncTopbarH).observe($('.topbar'));
else window.addEventListener('resize', syncTopbarH);

// hue stabil 0-359 dari judul — dipakai untuk warna cover buku
const hashHue = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

// monogram cover: huruf/pertama yang valid, lewati tanda kutip dkk.
const monogramOf = (t) => (t.trim().match(/[\p{L}\p{N}]/u)?.[0] || '•').toUpperCase();

// skeleton shimmer saat data awal dimuat
function showSkeletons(n) {
  const grid = $('#grid');
  grid.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const sk = document.createElement('div');
    sk.className = 'skeleton';
    sk.innerHTML = '<div class="sk sk-cover"></div><div class="sk sk-line w80"></div><div class="sk sk-line w60"></div><div class="sk sk-line w40"></div>';
    grid.appendChild(sk);
  }
}

// momen puncak: rayakan buku selesai dibaca
function celebrate() {
  const chars = ['🎉', '✨', '📚', '🏆', '⭐'];
  for (let i = 0; i < 6; i++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    el.textContent = chars[i % chars.length];
    el.style.left = 38 + Math.random() * 24 + '%';
    el.style.animationDelay = i * 90 + 'ms';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400 + i * 90);
  }
}
const validIds = new Set();

// Loader data: file disimpan sebagai .json.gz di web.
// - Web (server.mjs): Content-Encoding gzip → fetch() mendekode otomatis
// - APK: AAPT2 menghapus ekstensi .gz DAN mendekompresi isinya saat packaging
//   (Capacitor #5844) → fetch ke .json; magic bytes menentukan cara dekode
//   (jaga kompatibel jika isi ternyata tetap gzip → DecompressionStream)
const IS_NATIVE = !!window.Capacitor;
async function fetchGzJson(url) {
  const res = await fetch(url + (IS_NATIVE ? '.json' : '.json.gz'));
  if (!res.ok) throw new Error('gagal memuat ' + url);
  if (res.headers.get('Content-Encoding') === 'gzip') return await res.json();
  const buf = await res.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 2));
  let stream = new Blob([buf]).stream();
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('WebView terlalu lama untuk membuka data terkompresi — perbarui Android System WebView');
    }
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }
  return JSON.parse(await new Response(stream).text());
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
  const nReading = countValid(readingOnly);
  const nDone = countValid(state.done);
  const setBadge = (sel, n) => {
    const el = $(sel);
    el.textContent = String(n);
    el.classList.toggle('hidden', n === 0);
  };
  setBadge('#count-reading', nReading);
  setBadge('#count-done', nDone);
  setBadge('[data-nav-count="reading"]', nReading);
  setBadge('[data-nav-count="done"]', nDone);
}

// ---------- lanjutkan membaca (strip horizontal) ----------
function readingCandidates() {
  return Object.entries(state.reading)
    .filter(([id, r]) => validIds.has(id) && r?.pct > 0 && !isDone(id))
    .sort((a, b) => (b[1].updated || 0) - (a[1].updated || 0))
    .map(([id]) => id);
}

function bookById(id) {
  return (state.index?.books || []).find((b) => b.id === id);
}

function renderContinue() {
  const ids = readingCandidates().slice(0, 12);
  $('#continue-section').classList.toggle('hidden', ids.length === 0);
  const strip = $('#continue-strip');
  strip.innerHTML = '';
  for (const id of ids) {
    const b = bookById(id);
    if (!b) continue;
    const pct = getProgress(id);
    const el = document.createElement('button');
    el.className = 'continue-card';
    el.innerHTML = `${ringHtml(pct, false)}<span class="ctext"><strong>${highlight(b.title)}</strong><small>Dibaca ${pct}%</small></span>`;
    el.addEventListener('click', () => openReader(b));
    strip.appendChild(el);
  }
}

// cincin progress SVG (dipakai strip lanjut baca)
function ringHtml(pct, done) {
  const r = 19, c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(100, pct) / 100);
  return `<span class="c-ring${done ? ' done' : ''}"><svg viewBox="0 0 44 44"><circle class="ring-bg" cx="22" cy="22" r="${r}"></circle><circle class="ring-fg" cx="22" cy="22" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"></circle></svg>${done ? '' : `<span>${pct}%</span>`}</span>`;
}

// cover monogram — konsisten di grid & reader (hue dari hash judul)
// Slot <img> disiapkan untuk cover asli yang diambil saat online (lihat di bawah).
function coverHtml(hue, bookId) {
  return `<div class="card-cover" style="--cover-h:${hue}"${bookId ? ` data-book="${esc(bookId)}"` : ''}><img class="cover-img" alt="" decoding="async" /><div class="cover-book"><span class="cover-mono"></span><span class="cover-line"></span></div><span class="cover-cat"></span></div>`;
}

/* ---------- Cover asli: diambil saat online, dicache di IndexedDB ----------
   APK sengaja tidak memaketkan gambar: 4.8rb cover ≈ +61 MB. Sumber dicek
   berurutan Wikipedia → Google Books → Open Library, dan hanya dipakai bila
   judulnya mirip (≥0.6) supaya cover tidak salah pasang. Offline: monogram. */
const COVER_MIN_SIM = 0.6;
const COVER_NEG_TTL = 30 * 864e5; // hasil negatif dicache, dicoba lagi sebulan kemudian
const COVER_MAX_CONCURRENT = 4;

const coverDb = (() => {
  let pending;
  const open = () => (pending ||= new Promise((res, rej) => {
    const r = indexedDB.open('covers', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('img');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('img', mode);
      const rq = fn(t.objectStore('img'));
      t.oncomplete = () => res(rq.result);
      t.onerror = t.onabort = () => rej(t.error);
    });
  };
  return { get: (k) => run('readonly', (s) => s.get(k)), put: (k, v) => run('readwrite', (s) => s.put(v, k)) };
})();

const coverWords = (s) => String(s || '').toLowerCase().replace(/^(buku|book)\s+/i, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
const coverSim = (a, b) => {
  const B = coverWords(b);
  if (!B.length) return 0;
  const A = new Set(coverWords(a));
  return B.filter((w) => A.has(w)).length / B.length;
};

// Judul di katalog kadang menyisipkan nama penulis ("Everyday Millionaires Chris Hogan")
// — buang sebelum mencari supaya kueri tetap bersih.
function coverQuery(book) {
  let t = String(book.title || '');
  const a = String(book.author || '').trim();
  if (a.length > 3) {
    const i = t.toLowerCase().indexOf(a.toLowerCase());
    if (i > 0) t = (t.slice(0, i) + t.slice(i + a.length)).replace(/[\s,–—-]+$/, '');
  }
  return coverWords(t).join(' ');
}

// fetch dengan batas waktu — satu sumber yang lambat tidak boleh menyendat antrean
function coverFetch(url, ms = 4500) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return fetch(url, { signal: ac.signal }).finally(() => clearTimeout(t));
}

async function findCoverUrl(book) {
  const enc = encodeURIComponent(coverQuery(book));
  // 1. Open Library (CORS-aman, cakupan terbaik diukur: 44% title match persis)
  try {
    const q = `https://openlibrary.org/search.json?title=${enc}&limit=5&fields=cover_i,title`;
    const j = await (await coverFetch(q)).json();
    let best = null;
    for (const d of j.docs || []) {
      if (!d.cover_i) continue;
      const s = coverSim(book.title, d.title);
      if (!best || s > best.s) best = { s, url: `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` };
    }
    if (best && best.s >= COVER_MIN_SIM) return best.url;
  } catch { /* lanjut ke Wikipedia */ }
  // 2. Wikipedia id+en — untuk buku Indonesia; cari lewat pencarian, bukan judul persis
  for (const lang of ['id', 'en']) {
    try {
      const s = await (await coverFetch(`https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&list=search&srlimit=3&srsearch=${enc}`)).json();
      for (const hit of s.query?.search || []) {
        if (coverSim(book.title, hit.title) < COVER_MIN_SIM) continue;
        const p = await (await coverFetch(`https://${lang}.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=240&titles=${encodeURIComponent(hit.title)}`)).json();
        const pg = Object.values(p.query?.pages || {})[0];
        if (pg?.thumbnail?.source) return pg.thumbnail.source;
      }
    } catch { /* sumber berikutnya */ }
  }
  return null;
}

const coverQueue = [];
let coverBusy = 0;
function queueCoverEl(el, bookId) {
  if (!el || !bookId) return;
  el.dataset.book = bookId;
  const run = () => {
    coverBusy++;
    loadCover(el).finally(() => {
      coverBusy--;
      const next = coverQueue.shift();
      if (next) queueCoverEl(next[0], next[1]);
    });
  };
  if (coverBusy < COVER_MAX_CONCURRENT) run();
  else {
    // buang antrean untuk kartu yang sudah lepas (filter/geser cepat),
    // supaya kartu yang baru terlihat tidak menunggu giliran yang sia-sia
    for (let i = coverQueue.length - 1; i >= 0; i--) if (!coverQueue[i][0].isConnected) coverQueue.splice(i, 1);
    coverQueue.push([el, bookId]);
  }
}

async function loadCover(el) {
  const id = el.dataset.book;
  const book = state.byId && state.byId.get(id);
  if (!book) return;
  try {
    let rec = await coverDb.get(id);
    if (!rec || Date.now() - (rec.t || 0) > COVER_NEG_TTL) {
      if (!navigator.onLine) {
        if (rec && rec.ok) showCoverImg(el, rec.blob);
        return;
      }
      const url = await findCoverUrl(book);
      let blob = null;
      if (url) {
        try {
          const res = await coverFetch(url, 8000);
          const type = (res.headers.get('content-type') || '').split(';')[0];
          if (res.ok && /^image\/(jpeg|png|webp)$/.test(type)) {
            const b = await res.blob();
            if (b.size > 1200) blob = b; // tolak placeholder 1×1 / gambar rusak
          }
        } catch {
          // host menolak CORS → tampilkan langsung dari URL (online saja, tanpa cache)
          showRemoteCover(el, url);
          rec = { ok: false, url, t: Date.now(), nocache: true };
          await coverDb.put(id, rec);
          return;
        }
      }
      rec = { ok: !!blob, blob, url, t: Date.now() };
      await coverDb.put(id, rec);
    }
    if (rec.ok && rec.blob) showCoverImg(el, rec.blob);
    else if (rec.nocache && rec.url) showRemoteCover(el, rec.url);
  } catch (e) {
    console.warn('cover gagal:', id, (e && e.message) || e); // tetap monogram, tapi jangan diam
  }
}

function showCoverImg(el, blob) {
  if (el.dataset.coverDone) return;
  const img = coverImgEl(el);
  const url = URL.createObjectURL(blob);
  img.onload = () => { el.classList.add('has-img'); el.dataset.coverDone = '1'; URL.revokeObjectURL(url); };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

// host tanpa CORS: <img> tetap boleh dimuat, hanya tidak bisa di-cache offline
function showRemoteCover(el, url) {
  if (el.dataset.coverDone) return;
  const img = coverImgEl(el);
  img.onload = () => { el.classList.add('has-img'); el.dataset.coverDone = '1'; };
  img.src = url;
}

function coverImgEl(el) {
  let img = el.querySelector('.cover-img');
  if (!img) {
    img = document.createElement('img');
    img.className = 'cover-img';
    img.alt = '';
    img.decoding = 'async';
    el.prepend(img);
  }
  return img;
}

// hanya cover di dekat layar yang diambil (hemat kuota API)
let coverIO;
function observeCovers() {
  if (typeof IntersectionObserver === 'undefined') return;
  coverIO ||= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      coverIO.unobserve(e.target);
      queueCoverEl(e.target, e.target.dataset.book);
    }
  }, { rootMargin: '250px' });
  for (const el of document.querySelectorAll('.card-cover[data-book]')) {
    if (el.dataset.coverQueued) continue;
    el.dataset.coverQueued = '1';
    coverIO.observe(el);
  }
}

function ringBadge(pct, done) {
  if (!pct && !done) return '';
  const r = 13.5, c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(100, pct) / 100);
  return `<span class="cover-ring${done ? ' done' : ''}" data-pct="${pct}%"><svg viewBox="0 0 34 34"><circle class="ring-bg" cx="17" cy="17" r="${r}"></circle><circle class="ring-fg" cx="17" cy="17" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"></circle></svg></span>`;
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
  showSkeletons(8);
  state.index = await fetchGzJson('data/index'); // → data/index.json.gz (web) / .json di APK
  state.byId = new Map(state.index.books.map((b) => [b.id, b]));
  for (const b of state.index.books) validIds.add(b.id);
  const s = state.index.stats;
  $('#stat-line').textContent =
    `${s.total.toLocaleString('id-ID')} buku · ${s.totalWords.toLocaleString('id-ID')} kata · offline ✓`;

  // bersihkan status baca untuk buku yang tidak ada lagi
  state.done = state.done.filter((id) => validIds.has(id));
  for (const id of Object.keys(state.reading)) if (!validIds.has(id)) delete state.reading[id];
  // "reset" strip lanjut baca: embargo posisi baca, jangan simpan apa pun
  const resetAt = Number(localStorage.getItem(READING_RESET_KEY) || 0);
  if (resetAt) {
    for (const id of Object.keys(state.reading)) {
      if ((state.reading[id]?.updated || 0) < resetAt) delete state.reading[id];
    }
    persistReading();
    localStorage.removeItem(READING_RESET_KEY);
  }

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

  // pencarian + sinkronisasi UI (tombol hapus, pill "isi buku")
  const syncSearchUi = () => {
    $('#search-wrap').classList.toggle('has-value', $('#search').value.length > 0);
    $('#full-check').classList.toggle('on', $('#full-search').checked);
  };
  let debounceTimer;
  $('#search').addEventListener('input', (e) => {
    syncSearchUi();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      state.query = e.target.value.trim();
      applyFilters();
    }, 250);
  });
  $('#search-clear').addEventListener('click', () => {
    $('#search').value = '';
    state.query = '';
    syncSearchUi();
    applyFilters();
    $('#search').focus();
  });
  $('#full-search').addEventListener('change', (e) => {
    state.fullSearch = e.target.checked;
    syncSearchUi();
    if (state.query) applyFilters();
  });

  // tab status baca + bottom nav: dua kontrol, satu sumber
  // segmented pill: posisikan indikator geser di belakang tombol aktif
  const seg = $('#read-tabs');
  const moveSeg = (btn) => {
    if (!btn) return;
    seg.style.setProperty('--seg-w', btn.offsetWidth + 'px');
    seg.style.setProperty('--seg-x', btn.offsetLeft - 3 + 'px');
  };
  const syncTabs = (tab) => {
    const active = $('#read-tabs').querySelector('.seg-btn[data-tab="' + tab + '"]');
    $('#read-tabs').querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === active));
    moveSeg(active);
    document.querySelectorAll('.nav-item').forEach((b) => {
      b.classList.toggle('active', b.dataset.nav === tab || (tab === 'all' && b.dataset.nav === 'library'));
    });
  };
  requestAnimationFrame(() => syncTabs(state.readTab)); // posisi awal setelah layout
  window.addEventListener('resize', () => moveSeg($('#read-tabs').querySelector('.seg-btn.active')));
  $('#read-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    state.readTab = btn.dataset.tab;
    syncTabs(btn.dataset.tab);
    applyFilters();
  });
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.addEventListener('click', () => {
      state.readTab = b.dataset.nav === 'library' ? 'all' : b.dataset.nav;
      syncTabs(state.readTab);
      applyFilters();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    })
  );

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
    if (m) m.content = t === 'dark' ? '#141311' : t === 'sepia' ? '#f3e9d5' : '#f7f6f2';
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
    if (isDone(id)) {
      celebrate();
      toast('🎉 Selesai dibaca — kerja bagus!');
    } else {
      toast('Dikembalikan ke sedang dibaca');
    }
  });
  $('#toc-toggle').addEventListener('click', () => $('#reader-toc').classList.toggle('open'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeReader();
  });

  // strip "lanjutkan membaca" — reset memindahkan posisi baca (embargo), tanpa localStorage
  $('#continue-clear').addEventListener('click', () => {
    localStorage.setItem(READING_RESET_KEY, String(Date.now()));
    for (const id of Object.keys(state.reading)) delete state.reading[id];
    persistReading();
    renderContinue();
    updateCounts();
    applyFilters();
    toast('Posisi baca direset');
  });

  // tombol ikon pencarian di header — fokus ke kolom pencarian
  $('#search-jump').addEventListener('click', () => {
    $('#search').focus();
    $('#search').select();
    $('#search').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // empty state CTA — reset semua filter sekali ketuk
  $('#empty-reset').addEventListener('click', () => {
    state.query = '';
    state.categoryFilter = '';
    state.sourceFilter = 'all';
    state.fullSearch = false;
    $('#search').value = '';
    $('#category-select').value = '';
    $('#full-search').checked = false;
    syncSearchUi();
    chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.src === 'all'));
    applyFilters();
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
  renderContinue();
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
    const cat = b.category || 'Ringkasan';
    const card = document.createElement('div');
    card.className = 'card' + (doneFlag ? ' is-done' : '');
    card.style.setProperty('--i', i % 12); // stagger halus dalam batch
    card.innerHTML = `
      ${coverHtml(hashHue(b.title), b.id)}
      ${ringBadge(pct, doneFlag)}
      <div class="card-body">
        <h3>${highlight(b.title)}</h3>
        ${b.author ? `<p class="card-author">${esc(b.author)}</p>` : ''}
        <div class="card-meta"><span class="badge badge-${b.source}">${SOURCE_LABEL[b.source] || b.source}</span><span class="card-words">${b.words.toLocaleString('id-ID')} kata</span></div>
      </div>`;
    // monogram & kategori diisi textContent (bukan innerHTML) agar aman
    card.querySelector('.cover-mono').textContent = monogramOf(b.title);
    card.querySelector('.cover-cat').textContent = cat;
    card.addEventListener('click', () => openReader(b));
    frag.appendChild(card);
  }
  grid.appendChild(frag);
  observeCovers();
  // jika sentinel masih dalam jangkauan viewport (layar besar / hasil sedikit), muat batch berikutnya
  const rect = $('#sentinel').getBoundingClientRect();
  if (grid.children.length < state.filtered.length && rect.top < window.innerHeight + 600) {
    requestAnimationFrame(renderMore);
  }
}

// ---------- konten ----------
async function loadChunk(n) {
  if (state.contentCache.has(n)) return state.contentCache.get(n);
  const obj = await fetchGzJson(`data/content-${n}`); // → data/content-N.json.gz (web) / .json di APK
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
let onBodyScroll = null;

function closeReader() {
  $('#reader').classList.add('hidden');
  document.body.style.overflow = '';
  state.currentBook = null;
  renderContinue(); // segarkan strip setelah sesi baca
  updateCounts(); // badge "dibaca" ikut terbarui setelah progres terekam
}

function syncDoneButton() {
  const btn = $('#toggle-done');
  const on = state.currentBook && isDone(state.currentBook.id);
  btn.classList.toggle('on', !!on);
  btn.querySelector('.done-label').textContent = on ? 'Selesai dibaca' : 'Tandai selesai';
}

// toggle daftar isi (mobile) — sembunyikan tombol jika buku tanpa h2
function syncTocToggle(hasToc) {
  $('#toc-toggle').classList.toggle('hidden', !hasToc);
}

async function openReader(book) {
  state.currentBook = book;
  $('#reader').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  const hue = hashHue(book.title);
  document.querySelector('.reader-panel').style.setProperty('--cover-h', String(hue));
  $('#reader-cover-mono').textContent = monogramOf(book.title);
  queueCoverEl($('#reader-cover'), book.id);
  $('#reader-title').textContent = book.title;
  $('#reader-hero-title').textContent = book.title;
  $('#reader-meta').textContent =
    [book.author, SOURCE_LABEL[book.source], book.category, book.readMinutes ? `${book.readMinutes} menit baca` : null]
      .filter(Boolean).join(' · ');
  $('#reader-chips').innerHTML =
    [book.category, SOURCE_LABEL[book.source], book.readMinutes ? `${book.readMinutes} menit baca` : null]
      .filter(Boolean)
      .map((t, i) => `<span class="meta-chip${i === 0 ? ' chip-cat' : ''}">${esc(t)}</span>`)
      .join('');
  $('#reader-body').innerHTML = '<p style="color:var(--muted)">Memuat…</p>';
  $('#reader-toc').innerHTML = '';
  $('#reader-toc').classList.remove('open');
  $('#toc-toggle').classList.remove('hidden');
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
  let tocCount = 0;
  blocks.forEach((blk, idx) => {
    if (blk.type !== 'h2') return;
    tocCount++;
    const btn = document.createElement('button');
    btn.textContent = blk.text.length > 48 ? blk.text.slice(0, 48) + '…' : blk.text;
    btn.title = blk.text;
    btn.addEventListener('click', () => {
      const el = document.getElementById(`blk-${idx}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#reader-toc').classList.remove('open'); // tutup kembali di mobile
    });
    toc.appendChild(btn);
  });
  syncTocToggle(tocCount > 0);

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
  // lanjutkan dari posisi terakhir (paruh atas), selain itu mulai dari atas
  const scroller = $('#reader-scroll');
  const saved = getProgress(book.id);
  if (saved > 5 && saved < 95) {
    requestAnimationFrame(() => {
      scroller.scrollTop = ((scroller.scrollHeight - scroller.clientHeight) * saved) / 100;
    });
  } else {
    scroller.scrollTo({ top: 0 });
  }

  // progress berdasarkan posisi scroll — satu listener, dipasang ulang tiap buku
  let lastRecord = 0;
  if (onBodyScroll) scroller.removeEventListener('scroll', onBodyScroll);
  onBodyScroll = () => {
    const max = scroller.scrollHeight - scroller.clientHeight;
    const pct = max > 0 ? Math.round((scroller.scrollTop / max) * 100) : 100;
    $('#reader-progress-bar').style.width = pct + '%';
    const now = Date.now();
    if (now - lastRecord > 2000) {
      lastRecord = now;
      recordProgress(book.id, pct);
    }
  };
  scroller.addEventListener('scroll', onBodyScroll, { passive: true });

  // prefetch chunk berikutnya
  const total = state.index.stats.chunks;
  setTimeout(() => { if (book.chunk + 1 < total) loadChunk(book.chunk + 1); }, 1500);
}

init().catch((e) => {
  $('#stat-line').textContent = 'Gagal memuat data: ' + e.message;
  console.error(e);
});
