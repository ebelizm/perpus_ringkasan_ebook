// Scraper rofiatulmaos.com — via WP REST API, filter artikel ringkasan buku
import fs from 'fs';

const API = 'https://rofiatulmaos.com/wp-json/wp/v2';
const OUT = 'scratch/rofia_books.json';
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
    .replace(/&#8217;|&#8216;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#8230;/g, '…')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
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

async function fetchJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// 1. Ambil semua post (paginasi 100/halaman)
const first = await fetchJson(`${API}/posts?per_page=100&page=1&_fields=id,slug,title,content,link,date,categories`);
const totalPages = Number(first.headers?.get?.('x-wp-totalpages') ?? 0);
// fetch() tidak expose headers pada json; ambil dari response header terpisah
const headRes = await fetch(`${API}/posts?per_page=1&_fields=id`, { headers: { 'User-Agent': UA } });
const total = Number(headRes.headers.get('x-wp-total') || 0);
const pages = Math.ceil(total / 100) || 1;
console.log('Total post:', total, '→', pages, 'halaman');

const allPosts = [...first];
for (let p = 2; p <= pages; p++) {
  const posts = await fetchJson(`${API}/posts?per_page=100&page=${p}&_fields=id,slug,title,content,link,date,categories`);
  allPosts.push(...posts);
  if (p % 5 === 0) console.log(`  post: ${allPosts.length}/${total}`);
}
console.log('Post terkumpul:', allPosts.length);

// 2. Kategori map
const cats = await fetchJson(`${API}/categories?per_page=100&_fields=id,name,slug`);
const catMap = Object.fromEntries(cats.map((c) => [c.id, c.name]));

// 3. Ekstrak konten jadi blocks + filter ringkasan buku
function extractBlocks(rendered) {
  const blocks = [];
  const re = /<h([1-4])[^>]*>([\s\S]*?)<\/h\1>|<p[^>]*>([\s\S]*?)<\/p>|<(ul|ol)[^>]*>([\s\S]*?)<\/\4>/g;
  let m;
  while ((m = re.exec(rendered)) !== null) {
    if (m[1] !== undefined) {
      const t = stripTags(m[2]);
      if (t) blocks.push({ type: 'h2', text: t });
    } else if (m[3] !== undefined) {
      const t = stripTags(m[3]);
      if (t) blocks.push({ type: 'p', text: t });
    } else {
      const items = [...m[5].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
        .map((li) => stripTags(li[1]))
        .filter(Boolean);
      if (items.length) blocks.push({ type: 'list', items });
    }
  }
  return blocks;
}

const books = [];
const skipped = [];
for (const post of allPosts) {
  const title = decodeEntities(post.title?.rendered || '');
  const isBuku = /buku/i.test(title) || (post.categories || []).some((id) => (catMap[id] || '').toLowerCase() === 'buku');
  if (!isBuku) { skipped.push(post.slug); continue; }
  const blocks = extractBlocks(post.content?.rendered || '');
  if (blocks.length < 3) continue;
  books.push({
    source: 'rofia',
    slug: post.slug,
    title,
    author: null,
    tagline: null,
    collection: (post.categories || []).map((id) => catMap[id]).filter(Boolean).join(', ') || null,
    readMinutes: Math.max(1, Math.round(blocks.reduce((n, b) => n + (b.text || (b.items || []).join(' ')).split(/\s+/).length, 0) / 200)),
    blocks,
    url: post.link,
    date: post.date,
  });
}

fs.writeFileSync(OUT, JSON.stringify(books));
fs.writeFileSync('scratch/rofia_skipped.json', JSON.stringify(skipped, null, 2));
console.log(`SELESAI: ${books.length} ringkasan buku tersimpan (${skipped.length} post dilewati).`);
