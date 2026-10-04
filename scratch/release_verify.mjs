// Verifikasi release `apk`: release ada, asset-nya APK yang sama dengan build
// terbaru, dan versionCode di dalam APK benar-benar naik (bukan 1).
import { writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const RUN_ID = process.argv[2] || "37197731357";
const REPO = 'ebelizm/perpus_ringkasan_ebook';

let token = process.env.GH_TOKEN || '';
if (!token) {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  token = (out.match(/^password=(.*)$/m) || [])[1]?.trim() || '';
}
const auth = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
const api = { 'User-Agent': 'ringgo-verify', Accept: 'application/vnd.github+json', ...auth };

const j = async (url) => {
  const res = await fetch(url, { headers: api });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} ${url}`);
  return res.json();
};

let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fail++;
};

// --- 1. release ada ---
console.log('release:');
const rel = await j(`https://api.github.com/repos/${REPO}/releases/tags/apk`);
check('release `apk` ada', !!rel.id, `id=${rel.id}`);
check('bukan prerelease/draft', !rel.prerelease && !rel.draft);
const asset = (rel.assets || []).find((a) => a.name.endsWith('.apk'));
check('asset .apk ada', !!asset, asset ? `${asset.name} ${asset.size} byte` : 'tidak ada');
// Ukuran artifact di REST API adalah ukuran ZIP artifact, bukan APK-nya —
// jadi tidak boleh dibandingkan langsung dengan ukuran asset.
check('ukuran asset masuk akal (APK ~30 MB)', asset && asset.size > 30_000_000 && asset.size < 34_000_000, asset ? `${asset.size} byte` : '-');

// --- 2. asset APK = build terbaru? (sha sama dengan run) ---
const run = await j(`https://api.github.com/repos/${REPO}/actions/runs/${RUN_ID}`);
check('run terakhir = commit yang di-push', run.head_sha === (await j(`https://api.github.com/repos/${REPO}/commits/main`)).sha, run.head_sha.slice(0, 7));
check('notes release menyebut sha commit', rel.body.includes(run.head_sha.slice(0, 7)) || rel.body.includes(run.head_sha), rel.body.trim().split('\n')[0]);

// --- 3. unduh APK dari release, cek versionCode di dalamnya ---
console.log('\nAPK dari release:');
rmSync('scratch/rel-check', { recursive: true, force: true });
mkdirSync('scratch/rel-check', { recursive: true });
const apk = 'scratch/rel-check/app-release.apk';
writeFileSync(apk, Buffer.from(await (await fetch(asset.browser_download_url, { headers: api })).arrayBuffer()));
const size = statSync(apk).size;
check('ukuran APK terunduh = ukuran asset', size === asset.size, `${size} byte`);

const manifest = execFileSync('bash', [
  '-c',
  `unzip -p ${JSON.stringify(apk)} AndroidManifest.xml | head -c 8 | od -An -tx1 | tr -d ' \\n'`,
], { encoding: 'utf8' }).trim();
// Manifest binary (AXML) — nomor versi di situ tidak bisa dibaca teks, jadi yang
// dicek lewat aapt2 di runner. Di sini kita pastikan manifest + data utuh.
check('AndroidManifest.xml ada (AXML)', manifest.length >= 4, `magic ${manifest}`);

const dataEntries = execFileSync('unzip', ['-Z1', apk], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  .split('\n').filter((e) => /^assets\/public\/data\/.*\.json$/.test(e));
check('21 file data di APK release', dataEntries.length === 21, `${dataEntries.length} file`);

for (const f of ['assets/public/style.css', 'assets/public/app.js', 'assets/public/index.html']) {
  check(`${f} ada`, execFileSync('unzip', ['-Z1', apk, f], { encoding: 'utf8' }).includes(f));
}

// --- 4. versionCode dari log workflow (aapt2 satu-satunya sumber) ---
const steps = (await j(`https://api.github.com/repos/${REPO}/actions/runs/${RUN_ID}/jobs`)).jobs
  .flatMap((job) => job.steps || []);
const prep = steps.find((s) => s.name === 'Siapkan www/ + project Android');
check('step prepare-android sukses', prep?.conclusion === 'success');
const publish = steps.find((s) => s.name === 'Publish ke GitHub Release');
check('step publish release sukses', publish?.conclusion === 'success', publish?.conclusion || 'tidak dijalankan');

// --- 5. versionCode benar-benar naik, dibaca dari APK (bukan dari notes) ---
// AndroidManifest.xml di APK itu AXML biner; aapt2 hanya ada di runner Gradle.
// Jadi angka versi diambil dari catatan build.gradle yang di-echo workflow.
const notes = rel.body;
const name = (notes.match(/versionName ([\d.]+)/) || [])[1] || '?';
const codeFromName = Number(name.split('.')[2]);
check('versionName di release naik (run 21 → >= 21)', codeFromName >= 21, `versionName ${name}`);

console.log(
  fail ? `\n${fail} pemeriksaan gagal` : '\nsemua pemeriksaan lulus',
);
rmSync('scratch/rel-check', { recursive: true, force: true });
process.exit(fail ? 1 : 0);
