// Scraper F15 Library — ambil semua ringkasan buku dari sitemap
import fs from 'fs';

const SITEMAP_URL = 'https://www.f15library.com/sitemap.xml';
const OUT = 'scratch/f15_books.json';
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

function extractBlocks(html) {
  // Judul
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const title = h1 ? stripTags(h1[1]) : null;

  // Penulis + waktu baca (baris di bawah h1)
  const authorM = html.match(/<a[^>]*href="\/authors\/[^"]*"[^>]*>\s*oleh\s*([\s\S]*?)<\/a>/);
  const author = authorM ? stripTags(authorM[1]) : null;
  const rtM = html.match(/(\d+)\s*menit baca/);
  const readMinutes = rtM ? Number(rtM[1]) : null;

  // Koleksi (badge di atas judul)
  const collM = html.match(/<a[^>]*href="\/collections\/[^"]*"[^>]*>([\s\S]*?)<\/a>/);
  const collection = collM ? stripTags(collM[1]) : null;

  // Tagline (p max-w-md setelah author line)
  const tagM = html.match(/<p class="mt-2 max-w-md[^"]*"[^>]*>([\s\S]*?)<\/p>/);
  const tagline = tagM ? stripTags(tagM[1]) : null;

  // Konten: dari akhir h1 sampai section "Buku serupa"
  const endIdx = html.indexOf('aria-labelledby="related-heading"');
  const startIdx = h1 ? h1.index + h1[0].length : 0;
  let contentHtml = endIdx > startIdx ? html.slice(startIdx, endIdx) : html.slice(startIdx);
  // buang bagian header (author/tagline/tombol): mulai dari elemen konten pertama
  const firstContent = contentHtml.search(/<(p dir="ltr"|h2[\s>]|ul[\s>])/);
  if (firstContent > 0) contentHtml = contentHtml.slice(firstContent);

  // Walk blocks dalam urutan: h2 (heading), p dir=ltr (paragraf), ul (list)
  const blocks = [];
  const blockRe = /<h2[^>]*>([\s\S]*?)<\/h2>|<p dir="ltr"[^>]*>([\s\S]*?)<\/p>|<ul[^>]*>([\s\S]*?)<\/ul>/g;
  let m;
  while ((m = blockRe.exec(contentHtml)) !== null) {
    if (m[1] !== undefined) {
      const t = stripTags(m[1]);
      if (t) blocks.push({ type: 'h2', text: t });
    } else if (m[2] !== undefined) {
      const t = stripTags(m[2]);
      if (t) blocks.push({ type: 'p', text: t });
    } else if (m[3] !== undefined) {
      const items = [...m[3].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
        .map((li) => stripTags(li[1]))
        .filter(Boolean);
      if (items.length) blocks.push({ type: 'list', items });
    }
  }

  return { title, author, tagline, collection, readMinutes, blocks };
}

// ---- main ----
const sitemap = await fetchWithRetry(SITEMAP_URL);
const slugs = [...new Set([...sitemap.matchAll(/books\/([a-z0-9-]+)/g)].map((m) => m[1]))];
console.log('Total slug buku:', slugs.length);

const books = [];
let done = 0, failed = [];
// resume: muat checkpoint jika ada
if (fs.existsSync(OUT)) {
  try {
    const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    for (const b of prev) if (b && b.slug) books.push(b);
    console.log('Resume dari checkpoint:', books.length, 'buku sudah ada');
  } catch {}
}
const have = new Set(books.map((b) => b.slug));
const queue = slugs.filter((s) => !have.has(s));
console.log('Sisa yang perlu diambil:', queue.length);

async function worker(wid) {
  while (queue.length) {
    const slug = queue.shift();
    if (!slug) break;
    try {
      const html = await fetchWithRetry(`https://www.f15library.com/books/${slug}`);
      if (!html) { failed.push({ slug, err: '404' }); }
      else {
        const data = extractBlocks(html);
        if (!data.title || data.blocks.length < 3) {
          failed.push({ slug, err: 'konten terlalu pendek' });
        } else {
          books.push({ source: 'f15', slug, ...data });
        }
      }
    } catch (e) {
      failed.push({ slug, err: String(e.message || e) });
    }
    done++;
    if (done % 100 === 0) {
      console.log(`[w${wid}] ${done}/${queue.length + books.length} ok=${books.length} fail=${failed.length}`);
      fs.writeFileSync(OUT, JSON.stringify(books)); // checkpoint
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

books.sort((a, b) => a.slug.localeCompare(b.slug));
fs.writeFileSync(OUT, JSON.stringify(books));
fs.writeFileSync('scratch/f15_failed.json', JSON.stringify(failed, null, 2));
console.log(`SELESAI: ${books.length} buku tersimpan, ${failed.length} gagal.`);
