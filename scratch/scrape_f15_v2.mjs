// Scraper F15 v2 — extractor universal untuk kedua varian markup F15 Library.
// Rescrape buku yang kontennya tipis (<500 kata) atau tanpa paragraf; hasil digabung ke f15_books.json
import fs from 'fs';

const OUT = 'scratch/f15_books.json';
const FAILED = 'scratch/f15_failed_v2.json';
const CONCURRENCY = 10;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

const stripTags = (s) => decodeEntities(s.replace(/<[^>]+>/g, ''));
const wc = (s) => (s ? s.split(/\s+/).filter(Boolean).length : 0);

async function fetchWithRetry(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
      throw new Error('HTTP ' + res.status);
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
}

function extractAll(html, meta) {
  const blocks = [];
  const endIdx = html.indexOf('aria-labelledby="related-heading"');
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const startIdx = h1 ? h1.index + h1[0].length : 0;
  let content = endIdx > startIdx ? html.slice(startIdx, endIdx) : html.slice(startIdx);

  // Varian baru: konten berada di div class="book-content ..." — mulai dari sana
  const bc = content.indexOf('class="book-content');
  if (bc > -1) {
    const gt = content.indexOf('>', bc);
    if (gt > -1) content = content.slice(gt + 1);
  }
  // potong sebelum section "Buku serupa" bila penanda aria-labelledby tidak ada
  const rel = content.indexOf('id="related-heading"');
  if (rel > -1) content = content.slice(0, rel);

  const blockRe =
    /<h2[^>]*>([\s\S]*?)<\/h2>|<p(\s[^>]*)?>([\s\S]*?)<\/p>|<ul[^>]*>([\s\S]*?)<\/ul>/g;
  let m;
  while ((m = blockRe.exec(content)) !== null) {
    if (m[1] !== undefined) {
      const t = stripTags(m[1]);
      if (t) blocks.push({ type: 'h2', text: t });
    } else if (m[3] !== undefined) {
      // skip paragraf UI (punya class: tagline, kartu, dsb.) dan duplikat tagline
      if (m[2] && /class=/.test(m[2])) continue;
      const t = stripTags(m[3]);
      if (t && t !== meta.tagline) blocks.push({ type: 'p', text: t });
    } else if (m[4] !== undefined) {
      const items = [...m[4].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
        .map((li) => stripTags(li[1]))
        .filter(Boolean);
      if (items.length) blocks.push({ type: 'list', items });
    }
  }
  return { ...meta, blocks };
}

// ---- main ----
const books = JSON.parse(fs.readFileSync(OUT, 'utf8'));
console.log('dataset:', books.length, 'buku');

const wordOf = (b) =>
  b.blocks.reduce((n, blk) => n + wc(blk.text) + (blk.items ? blk.items.reduce((a, s) => a + wc(s), 0) : 0), 0);

// target: buku tipis / tanpa paragraf
const thin = books.filter((b) => {
  const paras = b.blocks.filter((x) => x.type === 'p').length;
  return wordOf(b) < 500 || paras < 3;
});
console.log('target rescrape:', thin.length, 'buku');

const bySlug = new Map(books.map((b) => [b.slug, b]));
const queue = thin.map((b) => b.slug);
let done = 0;
const stillFailed = [];
let improved = 0, unchanged = 0;

async function worker(wid) {
  while (queue.length) {
    const slug = queue.shift();
    if (!slug) break;
    try {
      const html = await fetchWithRetry(`https://www.f15library.com/books/${slug}`);
      if (!html) {
        stillFailed.push({ slug, err: '404' });
      } else {
        const meta = bySlug.get(slug);
        const data = extractAll(html, {
          title: meta.title, author: meta.author, tagline: meta.tagline,
          collection: meta.collection, readMinutes: meta.readMinutes,
        });
        const newW = wordOf(data);
        const oldW = wordOf(meta);
        if (newW > oldW) {
          meta.blocks = data.blocks;
          if (data.tagline) meta.tagline = data.tagline;
          if (data.author) meta.author = data.author;
          if (data.collection) meta.collection = data.collection;
          if (data.readMinutes) meta.readMinutes = data.readMinutes;
          improved++;
        } else {
          unchanged++;
        }
      }
    } catch (e) {
      stillFailed.push({ slug, err: String(e.message || e) });
    }
    done++;
    if (done % 100 === 0) {
      console.log(`[w${wid}] ${done} diproses, improved=${improved}, unchanged=${unchanged}, fail=${stillFailed.length}`);
      fs.writeFileSync(OUT, JSON.stringify(books));
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

fs.writeFileSync(OUT, JSON.stringify(books));
fs.writeFileSync(FAILED, JSON.stringify(stillFailed, null, 2));
console.log(`SELESAI: improved=${improved}, unchanged=${unchanged}, fail=${stillFailed.length}`);
