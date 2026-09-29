// Build: gabungkan f15_books.json + rofia_books.json → data/index.json + data/content-N.json
import fs from 'fs';

const CHUNK_SIZE = 250;
const DATA_DIR = 'data';
fs.mkdirSync(DATA_DIR, { recursive: true });

const f15 = JSON.parse(fs.readFileSync('scratch/f15_books.json', 'utf8'));
const rofia = JSON.parse(fs.readFileSync('scratch/rofia_books.json', 'utf8'));

function normalize(b, source) {
  let text = 0;
  for (const blk of b.blocks) text += (blk.text || blk.items.join(' ')).split(/\s+/).filter(Boolean).length;
  const excerpt = (b.blocks.find((x) => x.type === 'p')?.text || '').slice(0, 280);
  return {
    id: `${source}:${b.slug}`,
    source,
    title: b.title,
    sortTitle: b.title.replace(/^buku\s+/i, '').toLowerCase(),
    author: b.author || null,
    tagline: b.tagline || null,
    category: b.collection || null,
    readMinutes: b.readMinutes || null,
    words: text,
    excerpt,
    chunk: 0,
  };
}

const all = [
  ...f15.map((b) => normalize(b, 'f15')),
  ...rofia.map((b) => normalize(b, 'rofia')),
];
all.sort((a, b) => a.sortTitle.localeCompare(b.sortTitle, 'id'));

// Assign chunk
all.forEach((b, i) => { b.chunk = Math.floor(i / CHUNK_SIZE); });

// Simpan konten per chunk
const chunks = new Map();
for (const b of all) {
  const src = b.source === 'f15' ? f15 : rofia;
  const raw = src.find((x) => x.slug === b.id.split(':')[1]);
  if (!chunks.has(b.chunk)) chunks.set(b.chunk, {});
  chunks.get(b.chunk)[b.id] = raw.blocks;
}
for (const [n, obj] of chunks) {
  fs.writeFileSync(`${DATA_DIR}/content-${n}.json`, JSON.stringify(obj));
  console.log(`content-${n}.json:`, Object.keys(obj).length, 'buku,', Math.round(fs.statSync(`${DATA_DIR}/content-${n}.json`).size / 1024), 'KB');
}

// Index (tanpa blocks)
const byCategory = {};
const bySource = {};
for (const b of all) {
  const cat = b.category || 'Tanpa Kategori';
  byCategory[cat] = (byCategory[cat] || 0) + 1;
  bySource[b.source] = (bySource[b.source] || 0) + 1;
}
const totalWords = all.reduce((n, b) => n + b.words, 0);

const index = {
  generated: new Date().toISOString(),
  stats: {
    total: all.length,
    totalWords,
    chunks: chunks.size,
    bySource,
    categories: Object.fromEntries(Object.entries(byCategory).sort((a, b) => b[1] - a[1])),
  },
  books: all,
};
fs.writeFileSync(`${DATA_DIR}/index.json`, JSON.stringify(index));
console.log('index.json:', Math.round(fs.statSync(`${DATA_DIR}/index.json`).size / 1024 / 1024 * 10) / 10, 'MB');
console.log(`SELESAI: ${all.length} buku, ${totalWords.toLocaleString('id-ID')} kata, ${chunks.size} chunk.`);
