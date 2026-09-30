// Siapkan build Android: ikon → www/ → cap add → ikon native → copy
import fs from 'fs';
import { execSync } from 'child_process';

// 0. Generate ikon + splash (assets/icon.png, assets/splash.png, icons/)
execSync('node scratch/gen_icons.mjs', { stdio: 'inherit' });

// 1. Salin web app ke www/; data JSON di-gzip (APK jauh lebih kecil, app membuka .gz langsung)
fs.rmSync('www', { recursive: true, force: true });
fs.mkdirSync('www', { recursive: true });
for (const f of ['index.html', 'app.js', 'style.css', 'sw.js', 'manifest.webmanifest']) {
  fs.copyFileSync(f, `www/${f}`);
}
fs.cpSync('icons', 'www/icons', { recursive: true });
fs.cpSync('data', 'www/data', { recursive: true });
const { gzipSync } = await import('node:zlib');
let rawMB = 0, gzMB = 0;
for (const f of fs.readdirSync('www/data')) {
  if (!f.endsWith('.json')) continue;
  const p = `www/data/${f}`;
  const raw = fs.readFileSync(p);
  const gz = gzipSync(raw, { level: 9 });
  fs.writeFileSync(p + '.gz', gz);
  fs.unlinkSync(p); // app membuka file .gz langsung (fetch + DecompressionStream)
  rawMB += raw.length; gzMB += gz.length;
}
console.log(`www/ siap (data: ${(rawMB / 1048576).toFixed(1)} MB → gzip ${(gzMB / 1048576).toFixed(1)} MB)`);

// 2. Generate project android jika belum ada
if (!fs.existsSync('android')) {
  console.log('Menambahkan platform android (sekali saja)…');
  execSync('npx cap add android', { stdio: 'inherit' });
}

// 2b. Ikon & splash native dari assets/
try {
  execSync('npx --yes @capacitor/assets generate --android --assetPath assets', { stdio: 'inherit' });
} catch (e) {
  console.warn('Peringatan: generate ikon gagal (lanjut dengan ikon default):', e.message);
}

// 3. Salin aset web ke project android
// hapus aset lama dulu — cap copy tidak membersihkan tujuan (file basi menumpuk)
fs.rmSync('android/app/src/main/assets/public', { recursive: true, force: true });
execSync('npx cap copy android', { stdio: 'inherit' });
console.log('Siap di-build: cd android && ./gradlew assembleDebug');
