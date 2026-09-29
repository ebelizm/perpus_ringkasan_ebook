// Mapping slug → kategori dari semua halaman /collections/*, patch f15_books.json, rebuild
import fs from 'fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MAP_FILE = 'scratch/category_map.json';

const collections = fs.readFileSync('scratch/collections.txt', 'utf8')
  .split('\n').map((s) => s.trim()).filter(Boolean)
  .map((u) => u.replace('https://www.f15library.com/collections/', ''));

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function fetchText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (res.ok) return res.text();
      if (res.status === 404) return null;
      throw new Error('HTTP ' + res.status);
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
}

// resume
const map = fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')) : {};

const names = {};
for (const col of collections) {
  if (map['__name__' + col]) { names[col] = map['__name__' + col]; continue; }
  const first = await fetchText(`https://www.f15library.com/collections/${col}`);
  if (first) {
    const h1 = first.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
    if (h1) { names[col] = decodeEntities(h1[1].replace(/<[^>]+>/g, '').trim()); map['__name__' + col] = names[col]; }
  }
  // halaman 1 sudah terfetch — proses
  let page = 1, newCount = 0;
  while (page <= 200) {
    const html = page === 1 ? first : await fetchText(`https://www.f15library.com/collections/${col}?page=${page}`);
    if (!html) break;
    const links = [...html.matchAll(/href="\/books\/([a-z0-9-]+)"/g)].map((m) => m[1]);
    let added = 0;
    for (const slug of new Set(links)) {
      if (!map[slug]) { map[slug] = names[col] || col; added++; }
    }
    newCount += added;
    if (added === 0) break; // halaman habis / mulai berulang
    page++;
  }
  console.log(`${col} (${names[col] || col}): +${newCount} buku, total map=${Object.keys(map).filter(k=>!k.startsWith('__')).length}`);
  fs.writeFileSync(MAP_FILE, JSON.stringify(map));
}

// patch f15_books.json
const books = JSON.parse(fs.readFileSync('scratch/f15_books.json', 'utf8'));
let patched = 0;
for (const b of books) {
  const cat = map[b.slug];
  if (cat && b.collection !== cat) { b.collection = cat; patched++; }
}
fs.writeFileSync('scratch/f15_books.json', JSON.stringify(books));
console.log(`PATCHED: ${patched} buku diperbarui kategorinya. Total terpetakan: ${books.filter(b=>b.collection).length}/${books.length}`);
