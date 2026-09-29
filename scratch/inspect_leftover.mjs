import fs from 'fs';
const raw = JSON.parse(fs.readFileSync('scratch/rofia_books_raw.json', 'utf8'));
const parents = raw.filter((r) => /^buku\b/i.test(r.title));
const days = ['2026-05-29', '2026-06-04', '2026-06-06', '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-28', '2026-07-21'];
for (const day of days) {
  console.log('===', day, '===');
  const near = parents.filter((p) => {
    const d = Date.parse(String(p.date || '').slice(0, 10));
    return !Number.isNaN(d) && Math.abs(d - Date.parse(day)) <= 10 * 86400000;
  });
  for (const p of near) console.log('  ', String(p.date).slice(0, 10), '|', p.title.slice(0, 85));
}
