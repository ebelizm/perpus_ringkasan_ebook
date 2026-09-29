// Gabungkan artikel rofiatulmaos yang terpecah per bagian ke entri buku induknya. (v2)
// - Referensi "Buku X" di konten (skor lebih longgar)
// - Fallback: jendela tanggal (bagian berada setelah artikel induk & sebelum bagian induk lain berikutnya)
// - Judul bersih dicocokkan ke F15 dengan prefix kata (buang nama penulis di ekor judul)
import fs from 'fs';

if (!fs.existsSync('scratch/rofia_books_raw.json')) {
  fs.copyFileSync('scratch/rofia_books.json', 'scratch/rofia_books_raw.json');
}
const raw = JSON.parse(fs.readFileSync('scratch/rofia_books_raw.json', 'utf8'));
const f15 = JSON.parse(fs.readFileSync('scratch/f15_books.json', 'utf8'));

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const wordCount = (blocks) =>
  blocks.reduce((n, x) => n + (x.text || (x.items || []).join(' ')).split(/\s+/).filter(Boolean).length, 0);
const stripArticle = (s) => s.replace(/^(the|a|an)\s+/, '');
const dateMs = (d) => (d ? Date.parse(d) : NaN);

const ROMAN = { i:1, ii:2, iii:3, iv:4, v:5, vi:6, vii:7, viii:8, ix:9, x:10, xi:11, xii:12, xiii:13, xiv:14, xv:15 };
const WORDNUM = { satu:1, dua:2, tiga:3, empat:4, lima:5, enam:6, tujuh:7, delapan:8, sembilan:9, sepuluh:10 };

function cleanTitle(t) {
  let s = t.replace(/^buku\s+/i, '');
  s = s.replace(/,\s*(bagian|bab|part)\b.*$/i, '');
  s = s.replace(/\s*[-–—:]\s*$/, '').trim();
  return s || t;
}

// ----- 1. Pisahkan induk & lainnya -----
const parents = [], rest = [];
for (const art of raw) {
  if (/^buku\b/i.test(art.title)) parents.push({ book: art, base: cleanTitle(art.title), baseNorm: norm(cleanTitle(art.title)), parts: [] });
  else rest.push(art);
}

// pencocokan dasar: exact, prefix, atau prefix-kata (buang kata ekor = nama penulis)
function findParent(baseNorm) {
  const target = stripArticle(baseNorm);
  for (const p of parents) {
    const pn = stripArticle(p.baseNorm);
    if (pn === target) return { p, score: 100 };
    if (target.length >= 12 && (pn.startsWith(target) || target.startsWith(pn))) {
      return { p, score: Math.min(target.length, pn.length) };
    }
  }
  // prefix-kata: buang kata belakang target satu-satu (penulis), min 3 kata
  const words = target.split(' ');
  for (let cut = words.length - 1; cut >= 3; cut--) {
    const prefix = words.slice(0, cut).join(' ');
    if (prefix.length < 12) break;
    for (const p of parents) {
      const pn = stripArticle(p.baseNorm);
      if (pn === prefix || pn.startsWith(prefix + ' ')) return { p, score: prefix.length };
    }
  }
  return null;
}

// ----- 2. Kumpulkan referensi konten per artikel bagian -----
const partPrefix = /^\s*(bab|bagian|part|bag\.|chapter)\b[\s:.-]*/i;
const numPrefix = /^\s*(\d{1,2})\s*[.:\-]\s+/;

function partNumber(title) {
  let m = title.match(/^(?:bab|bagian|part|chapter)\s+([\d]{1,2}|[ivx]+|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\b/i);
  if (m) {
    const tok = m[1].toLowerCase();
    return /^\d+$/.test(tok) ? Number(tok) : (ROMAN[tok] ?? WORDNUM[tok] ?? null);
  }
  m = title.match(/^(\d{1,2})\s*[.:\-]\s+/);
  return m ? Number(m[1]) : null;
}

const unassigned = [];
for (const art of rest) {
  const isPart = partPrefix.test(art.title) || numPrefix.test(art.title);
  if (!isPart) { unassigned.push(art); continue; }
  const text = art.blocks.map((x) => x.text || (x.items || []).join(' ')).join(' ');
  let hit = null;
  for (const ref of text.matchAll(/[Bb]uku\s+((?:["“'])?[A-Z][^.,;!?\n]{3,80})/g)) {
    const found = findParent(norm(ref[1]));
    if (found && found.score >= 15) { hit = found.p; break; }
  }
  if (hit) hit.parts.push({ art, num: partNumber(art.title) ?? 999, via: 'ref' });
  else unassigned.push(art);
}
console.log('via referensi konten:', parents.reduce((n, p) => n + p.parts.length, 0));

// ----- 3. Fallback: judul induk yang muncul di teks artikel bagian -----
// Banyak bagian menyebut judul bukunya tanpa kata "Buku" (mis. "di buku The 5 AM Club").
// Kita cari prefix judul induk (4+ kata, atau 3 kata bila mengandung angka) di dalam teks.
const stillUnassigned = [];
let viaTitle = 0;
for (const art of unassigned) {
  const isPart = partPrefix.test(art.title) || numPrefix.test(art.title);
  if (!isPart) { stillUnassigned.push(art); continue; }
  const text = norm(art.blocks.map((x) => x.text || (x.items || []).join(' ')).join(' '));
  let best = null, bestScore = 0;
  for (const p of parents) {
    const words = stripArticle(p.baseNorm).split(' ');
    const maxCut = Math.min(words.length, 10);
    for (let cut = maxCut; cut >= 3; cut--) {
      const prefix = words.slice(0, cut).join(' ');
      const ok = cut >= 4 || /\d/.test(prefix);
      if (!ok || prefix.length < 10) continue;
      if (text.includes(prefix)) { if (cut > bestScore) { best = p; bestScore = cut; } break; }
    }
  }
  if (best && bestScore >= 3) {
    best.parts.push({ art, num: partNumber(art.title) ?? 999, via: 'title' });
    viaTitle++;
  } else {
    stillUnassigned.push(art);
  }
}
console.log('via judul-di-teks:', viaTitle);

// ----- 3b. Kelompokkan sisa bagian per tanggal terbit; pasangkan dengan induk -----
// (a) judul-di-teks terhadap induk dalam jendela 14 hari
// (b) induk unik yang terbit di hari yang sama
// (c) lanjutan bernomor: nomor induk (dari judul/bagian) < nomor kelompok, jarak <=14 hari
const partStill = stillUnassigned.filter((a) => partPrefix.test(a.title) || numPrefix.test(a.title));
const nonPart = stillUnassigned.filter((a) => !(partPrefix.test(a.title) || numPrefix.test(a.title)));
const dayKey = (a) => String(a.date || '').slice(0, 10);
const clusters = new Map();
for (const art of partStill) {
  const k = dayKey(art);
  if (!k || k === 'Invalid Date' || k === 'undefined') continue;
  if (!clusters.has(k)) clusters.set(k, []);
  clusters.get(k).push(art);
}
const sortedDates = [...clusters.keys()].sort();
let viaSameDay = 0, viaContinuation = 0, viaTitleWindow = 0;
const unassignedFinal = [...nonPart];

function matchByTitleText(art, candidates) {
  const text = norm(art.blocks.map((x) => x.text || (x.items || []).join(' ')).join(' '));
  let best = null, bestScore = 0;
  for (const p of candidates) {
    const words = stripArticle(p.baseNorm).split(' ');
    for (let cut = Math.min(words.length, 10); cut >= 3; cut--) {
      const prefix = words.slice(0, cut).join(' ');
      if (prefix.length < 10 || (cut < 4 && !/\d/.test(prefix))) continue;
      if (text.includes(prefix)) { if (cut > bestScore) { best = p; bestScore = cut; } break; }
    }
  }
  return best;
}

function titleNum(p) {
  const m = p.book.title.match(/(?:bab|bagian|part)\s+([\d]{1,2}|[ivx]+|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\b/i);
  if (!m) return 0;
  const tok = m[1].toLowerCase();
  return /^\d+$/.test(tok) ? Number(tok) : (ROMAN[tok] ?? WORDNUM[tok] ?? 0);
}
const maxNumOf = (p) => Math.max(titleNum(p), ...p.parts.map((x) => (x.num === 999 ? -1 : x.num)));
const lastActivityOf = (p) => Math.max(dateMs(p.book.date), ...p.parts.map((x) => dateMs(x.art.date)));

for (const day of sortedDates) {
  const group = clusters.get(day);
  const dayMs = Date.parse(day);
  const sameDayParents = parents.filter((p) => dayKey(p.book) === day && p.parts.length < 40);
  const windowParents = parents.filter((p) => {
    const last = lastActivityOf(p);
    return !Number.isNaN(last) && dayMs - last >= 0 && dayMs - last <= 14 * 86400000 && p.parts.length < 60;
  });

  // (a) cocokkan per artikel lewat judul di teks terhadap induk dalam jendela
  const matched = new Map();
  for (const art of group) {
    const p = matchByTitleText(art, windowParents);
    if (p) matched.set(art, p);
  }
  for (const [art, p] of matched) { p.parts.push({ art, num: partNumber(art.title) ?? 999, via: 'title-window' }); viaTitleWindow++; }
  let restGroup = group.filter((a) => !matched.has(a));

  // (b) induk unik yang terbit di hari yang sama
  if (restGroup.length && sameDayParents.length === 1) {
    for (const art of restGroup) { sameDayParents[0].parts.push({ art, num: partNumber(art.title) ?? 999, via: 'sameday' }); viaSameDay++; }
    restGroup = [];
  }

  // (c) lanjutan bernomor unik
  if (restGroup.length) {
    const minNum = Math.min(...restGroup.map((a) => partNumber(a.title) ?? 999));
    const cont = windowParents.filter((p) => maxNumOf(p) < minNum);
    if (cont.length === 1) {
      for (const art of restGroup) { cont[0].parts.push({ art, num: partNumber(art.title) ?? 999, via: 'continuation' }); viaContinuation++; }
      restGroup = [];
    }
  }
  unassignedFinal.push(...restGroup);
}
stillUnassigned.length = 0;
stillUnassigned.push(...unassignedFinal);
console.log('via judul-window:', viaTitleWindow, '| via hari-sama:', viaSameDay, '| via lanjutan:', viaContinuation, '| tetap mandiri:', stillUnassigned.length);

// ----- 3c. Pemetaan manual berbasis konteks buku (sisa yang tak terdeteksi otomatis) -----
const MANUAL_MAP = [
  { part: /kitchen|recycle|cleaning and housekeeping|holidays and gifts/i, parent: /zero waste home/i },
  { part: /the melting pot|the hard sell|the pursuit of pep|the computer age|playing games/i, parent: /made in america/i },
  { part: /knotek|kathy loreno|shane watson|ron woodworth|pelarian dan keadilan|warisan trauma/i, parent: /if you tell/i },
  { part: /masa kecil di gurun|welch, virginia|pengerasan dan rencana|kehancuran maureen|kematian rex/i, parent: /glass castle/i },
  { part: /trans-siberia|kongo|timur tengah/i, parent: /step by step/i },
  { part: /perlengkapan esensial|kebersihan diri dan pakaian|keamanan dan menghadapi|tetap sehat secara fisik|hidup minimalis dan melepaskan/i, parent: /how to live in a car/i },
  { part: /penyampaian.{0,3}vokal/i, parent: /public speaking essentials/i },
  { part: /formula 20\/20\/20|empat kerajaan batin|protokol 66 hari|metode 90\/90\/1|pesan dari para maestro/i, parent: /the 5 am club/i },
  { part: /strategi anti-tunda/i, parent: /the miracle morning/i },
  { part: /memahami anak anda|ruang untuk tumbuh bersama|mengelola semua perasaan|menetapkan batasan dengan cinta|warisan sejati untuk anak/i, parent: /book you wish your parents had read/i },
  { part: /tindakan \(action\)|kehendak \(will\)/i, parent: /obstacle is the way/i },
];
let viaManual = 0;
const manualLeft = [];
for (const art of stillUnassigned) {
  const rule = MANUAL_MAP.find((r) => r.part.test(art.title));
  const p = rule ? parents.find((x) => rule.parent.test(x.book.title)) : null;
  if (p) { p.parts.push({ art, num: partNumber(art.title) ?? 999, via: 'manual' }); viaManual++; }
  else manualLeft.push(art);
}
stillUnassigned.length = 0;
stillUnassigned.push(...manualLeft);
console.log('via manual:', viaManual, '| tetap mandiri:', stillUnassigned.length);

// sisa part yang tak terpetakan (untuk inspeksi)
const leftover = stillUnassigned.filter((a) => partPrefix.test(a.title) || numPrefix.test(a.title));
if (leftover.length) {
  console.log('--- sisa part tak terpetakan:', leftover.length, '---');
  for (const a of leftover.slice(0, 20)) console.log('  ', a.date?.slice(0, 10), '|', a.title.slice(0, 70));
}

// ----- 4. Gabungkan bloks dengan dedup -----
const seenKey = (b) => norm(b.text || (b.items || []).join(' '));
function dedup(parentBlocks, childBlocks) {
  const seen = new Set(parentBlocks.map(seenKey).filter(Boolean));
  const out = [];
  for (const b of childBlocks) {
    const k = seenKey(b);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(b);
  }
  return out;
}

const merged = [];
let totalParts = 0;
for (const p of parents) {
  if (p.parts.length === 0) { merged.push(p.book); continue; }
  p.parts.sort((a, b) => a.num - b.num || dateMs(a.art.date) - dateMs(b.art.date));
  const blocks = [...p.book.blocks];
  for (const part of p.parts) {
    blocks.push({ type: 'h2', text: part.art.title });
    blocks.push(...dedup(p.book.blocks, part.art.blocks));
    totalParts++;
  }
  merged.push({ ...p.book, blocks, readMinutes: Math.max(1, Math.round(wordCount(blocks) / 200)) });
}
for (const art of stillUnassigned) merged.push(art);

console.log('bagian dilebur total:', totalParts, '| entri rofia:', raw.length, '→', merged.length);

// ----- 5. Judul bersih via F15 (prefix kata) -----
const f15Titles = f15.map((b) => ({ norm: stripArticle(norm(b.title)), title: b.title }));
const f15Map = new Map(f15Titles.map((x) => [x.norm, x.title]));
let renamed = 0;
for (const b of merged) {
  if (!/^buku\b/i.test(b.title)) continue;
  const words = stripArticle(norm(cleanTitle(b.title))).split(' ');
  let newTitle = null;
  for (let cut = words.length; cut >= 3; cut--) {
    const prefix = words.slice(0, cut).join(' ');
    if (f15Map.has(prefix)) { newTitle = f15Map.get(prefix); break; }
  }
  if (newTitle) { b.title = newTitle; renamed++; }
}
console.log('judul induk disamakan dengan F15:', renamed);

// 5b. bersihkan sisa judul "Buku X Penulis, Bab N ..." → "X Penulis"
let cleaned = 0;
for (const b of merged) {
  if (/^buku\b/i.test(b.title)) { b.title = cleanTitle(b.title); cleaned++; }
}
console.log('judul induk dibersihkan:', cleaned);

merged.sort((a, b) => a.slug.localeCompare(b.slug));
fs.writeFileSync('scratch/rofia_books.json', JSON.stringify(merged));
console.log('SELESAI. total kata:', merged.reduce((n, b) => n + wordCount(b.blocks), 0).toLocaleString('id-ID'));

// contoh hasil untuk spot-check
console.log('\n=== CONTOH INDUK DENGAN BAGIAN ===');
for (const p of parents.filter((x) => x.parts.length > 0).slice(0, 6)) {
  console.log('-', p.book.title.slice(0, 60), '| bagian:', p.parts.map((x) => x.art.title.slice(0, 30)).join(' ; '));
}
