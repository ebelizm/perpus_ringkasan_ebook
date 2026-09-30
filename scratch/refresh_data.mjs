// Refresh incremental dataset dari kedua situs.
// - F15: bandingkan slug sitemap vs dataset; buku baru di-scrape penuh (extractor v2).
//        Buku lama di-scrape ulang secara bergilir per keping (dataStale.pct) agar konten selalu segar.
// - Rofia: WP API modified_after; post baru/berubah di-scrape dan digabung via merge_parts.
// - Terakhir: node scratch/build.mjs (rebuild data offline).
import fs from 'fs';
import { execSync } from 'child_process';

const STATE_FILE = 'scratch/refresh_state.json';
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

// ===== extractor v2 (universal, kedua varian markup) =====
function extractAll(html) {
  const blocks = [];
  const endIdx = html.indexOf('aria-labelledby="related-heading"');
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const startIdx = h1 ? h1.index + h1[0].length : 0;
  let content = endIdx > startIdx ? html.slice(startIdx, endIdx) : html.slice(startIdx);

  const bc = content.indexOf('class="book-content');
  if (bc > -1) {
    const gt = content.indexOf('>', bc);
    if (gt > -1) content = content.slice(gt + 1);
  }
  const rel = content.indexOf('id="related-heading"');
  if (rel > -1) content = content.slice(0, rel);

  const title = h1 ? stripTags(h1[1]) : null;
  const authorM = html.match(/<a[^>]*href="\/authors\/[^"]*"[^>]*>\s*oleh\s*([\s\S]*?)<\/a>/);
  const author = authorM ? stripTags(authorM[1]) : null;
  const rtM = html.match(/(\d+)\s*menit baca/);
  const readMinutes = rtM ? Number(rtM[1]) : null;
  const tagM = html.match(/<p class="mt-2 max-w-md[^"]*"[^>]*>([\s\S]*?)<\/p>/);
  const tagline = tagM ? stripTags(tagM[1]) : null;

  const blockRe = /<h2[^>]*>([\s\S]*?)<\/h2>|<p(\s[^>]*)?>([\s\S]*?)<\/p>|<ul[^>]*>([\s\S]*?)<\/ul>/g;
  let m;
  while ((m = blockRe.exec(content)) !== null) {
    if (m[1] !== undefined) {
      const t = stripTags(m[1]);
      if (t) blocks.push({ type: 'h2', text: t });
    } else if (m[3] !== undefined) {
      if (m[2] && /class=/.test(m[2])) continue;
      const t = stripTags(m[3]);
      if (t && t !== tagline) blocks.push({ type: 'p', text: t });
    } else if (m[4] !== undefined) {
      const items = [...m[4].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((li) => stripTags(li[1])).filter(Boolean);
      if (items.length) blocks.push({ type: 'list', items });
    }
  }
  return { title, author, tagline, readMinutes, blocks };
}

// koleksi sejati = link /collections/ terakhir sebelum h1 (bukan menu header)
function extractCollection(html) {
  const h1 = html.match(/<h1[^>]*>/);
  if (!h1) return null;
  const before = html.slice(0, h1.index);
  const links = [...before.matchAll(/href="\/collections\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  if (!links.length) return null;
  const last = links[links.length - 1];
  return { slug: last[1], name: stripTags(last[2]) || last[1] };
}

const state = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  : { f15Rotation: 0, rofiaModified: null };
const nowIso = new Date().toISOString();
let changes = { f15New: 0, f15Updated: 0, f15Rechecked: 0, rofiaNew: 0, rofiaUpdated: 0 };

// ================= F15 =================
{
  const sitemap = await fetchWithRetry('https://www.f15library.com/sitemap.xml');
  const slugs = [...new Set([...sitemap.matchAll(/books\/([a-z0-9-]+)/g)].map((m) => m[1]))];
  const books = JSON.parse(fs.readFileSync('scratch/f15_books.json', 'utf8'));
  const bySlug = new Map(books.map((b) => [b.slug, b]));

  // kategori map dari refresh sebelumnya (untuk buku baru)
  const catMap = fs.existsSync('scratch/category_map.json')
    ? JSON.parse(fs.readFileSync('scratch/category_map.json', 'utf8'))
    : {};

  // 1. buku baru
  const newSlugs = slugs.filter((s) => !bySlug.has(s));
  console.log('F15: buku baru =', newSlugs.length);
  for (const slug of newSlugs) {
    const html = await fetchWithRetry(`https://www.f15library.com/books/${slug}`);
    if (!html) continue;
    const data = extractAll(html);
    if (!data.title || data.blocks.length < 3) continue;
    const coll = extractCollection(html) || { slug: null, name: catMap[slug] || null };
    books.push({
      source: 'f15', slug,
      title: data.title, author: data.author, tagline: data.tagline,
      collection: coll.name, readMinutes: data.readMinutes, blocks: data.blocks,
    });
    if (coll.name && catMap[slug] === undefined) catMap[slug] = coll.name;
    changes.f15New++;
  }

  // 2. rotasi pengecekan ulang: keping dari buku lama, urutan stabil
  const ROTATION_PCT = Number(process.env.ROTATION_PCT || 5);
  const old = books.filter((b) => !newSlugs.includes(b.slug));
  old.sort((a, b) => a.slug.localeCompare(b.slug));
  const step = Math.max(1, Math.round(old.length * (ROTATION_PCT / 100)));
  const start = state.f15Rotation % old.length;
  const batch = [];
  for (let i = 0; i < Math.min(step, old.length); i++) batch.push(old[(start + i) % old.length]);
  console.log(`F15: recheck rotasi ${batch.length} buku (keping ${Math.floor(start / step) + 1})`);

  const wordOf = (b) => b.blocks.reduce((n, blk) => n + wc(blk.text) + (blk.items ? blk.items.reduce((a, s) => a + wc(s), 0) : 0), 0);
  let rIdx = 0;
  async function recheckWorker() {
    while (rIdx < batch.length) {
      const b = batch[rIdx++];
      try {
        const html = await fetchWithRetry(`https://www.f15library.com/books/${b.slug}`);
        changes.f15Rechecked++;
        if (!html) continue;
        const data = extractAll(html);
        if (!data.title || data.blocks.length < 3) continue;
        const coll = extractCollection(html);
        if (coll && b.collection !== coll.name) { b.collection = coll.name; changes.f15Updated++; }
        if (data.tagline) b.tagline = data.tagline;
        if (data.author) b.author = data.author;
        if (data.readMinutes) b.readMinutes = data.readMinutes;
        if (Math.abs(wordOf(data) - wordOf(b)) > 20) {
          b.blocks = data.blocks;
          changes.f15Updated++;
        }
      } catch { /* lanjut ke buku berikutnya */ }
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => recheckWorker()));
  state.f15Rotation = (start + batch.length) % Math.max(old.length, 1);

  fs.writeFileSync('scratch/f15_books.json', JSON.stringify(books));
  if (Object.keys(catMap).length) fs.writeFileSync('scratch/category_map.json', JSON.stringify(catMap));
}

// ================= Rofia =================
{
  const API = 'https://rofiatulmaos.com/wp-json/wp/v2';
  const modifiedAfter = state.rofiaModified;
  const url = modifiedAfter
    ? `${API}/posts?per_page=100&orderby=modified&order=desc&modified_after=${encodeURIComponent(modifiedAfter)}&_fields=id,slug,title,content,link,date,modified,categories`
    : `${API}/posts?per_page=100&orderby=modified&order=desc&_fields=id,slug,title,content,link,date,modified,categories`;

  let posts = [];
  let page = 1;
  while (true) {
    const raw = await fetchWithRetry(`${url}&page=${page}`);
    if (!raw) break;
    const arr = JSON.parse(raw);
    posts.push(...arr);
    if (arr.length < 100 || page >= 10) break; // cukup: post terbaru-ubah sudah tercakup
    page++;
  }
  console.log('Rofia: post berubah/new sejak', modifiedAfter || 'awal', '=', posts.length);

  if (posts.length) {
    const raw = JSON.parse(fs.readFileSync('scratch/rofia_books_raw.json', 'utf8'));
    const bySlug = new Map(raw.map((b) => [b.slug, b]));
    const cats = JSON.parse(await fetchWithRetry(`${API}/categories?per_page=100&_fields=id,name`));
    const catMap = Object.fromEntries(cats.map((c) => [c.id, c.name]));

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
          const items = [...m[5].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((li) => stripTags(li[1])).filter(Boolean);
          if (items.length) blocks.push({ type: 'list', items });
        }
      }
      return blocks;
    }

    for (const post of posts) {
      const title = decodeEntities(post.title?.rendered || '');
      const isBuku = /buku/i.test(title) || (post.categories || []).some((id) => (catMap[id] || '').toLowerCase() === 'buku');
      if (!isBuku) continue;
      const blocks = extractBlocks(post.content?.rendered || '');
      if (blocks.length < 3) continue;
      const entry = {
        source: 'rofia', slug: post.slug, title, author: null, tagline: null,
        collection: (post.categories || []).map((id) => catMap[id]).filter(Boolean).join(', ') || null,
        readMinutes: Math.max(1, Math.round(blocks.reduce((n, b) => n + (b.text || (b.items || []).join(' ')).split(/\s+/).length, 0) / 200)),
        blocks, url: post.link, date: post.date,
      };
      if (bySlug.has(post.slug)) { Object.assign(bySlug.get(post.slug), entry); changes.rofiaUpdated++; }
      else { raw.push(entry); bySlug.set(post.slug, entry); changes.rofiaNew++; }
    }
    fs.writeFileSync('scratch/rofia_books_raw.json', JSON.stringify(raw));
  }
  state.rofiaModified = nowIso;
}

fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// ================= merge + build =================
execSync('node scratch/merge_parts.mjs', { stdio: 'inherit' });
execSync('node scratch/build.mjs', { stdio: 'inherit' });

console.log('CHANGES:', JSON.stringify(changes));
console.log('REFRESH SELESAI', nowIso);
