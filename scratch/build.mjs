// Build: gabungkan f15_books.json + rofia_books.json → data/index.json.gz + data/content-N.json.gz
// Data offline disimpan ter-gzip permanen: repo kecil, APK kecil, web menyajikan via Content-Encoding.
import fs from 'fs';
import zlib from 'node:zlib';

const CHUNK_SIZE = 250;
const DATA_DIR = 'data';
fs.mkdirSync(DATA_DIR, { recursive: true });
// hapus file data lama (raw maupun gz) agar tidak ada sisa campuran
for (const f of fs.readdirSync(DATA_DIR)) fs.rmSync(`${DATA_DIR}/${f}`, { force: true });

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
  const p = `${DATA_DIR}/content-${n}.json.gz`;
  fs.writeFileSync(p, zlib.gzipSync(JSON.stringify(obj), { level: 9 }));
  console.log(`content-${n}.json.gz:`, Object.keys(obj).length, 'buku,', Math.round(fs.statSync(p).size / 1024), 'KB');
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
const idxPath = `${DATA_DIR}/index.json.gz`;
fs.writeFileSync(idxPath, zlib.gzipSync(JSON.stringify(index), { level: 9 }));
console.log('index.json.gz:', Math.round(fs.statSync(idxPath).size / 1024 / 1024 * 10) / 10, 'MB');
console.log(`SELESAI: ${all.length} buku, ${totalWords.toLocaleString('id-ID')} kata, ${chunks.size} chunk.`);
