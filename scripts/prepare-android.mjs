// Siapkan build Android: ikon → www/ → cap add → ikon native → copy
import fs from 'fs';
import { execSync } from 'child_process';

// 0. Generate ikon + splash (assets/icon.png, assets/splash.png, icons/)
execSync('node scratch/gen_icons.mjs', { stdio: 'inherit' });

// 1. Salin web app ke www/. Data di repo sudah berupa .json.gz (build.mjs yang menghasilkan),
//    jadi cukup disalin — tanpa kompresi ulang, tanpa file mentah.
fs.rmSync('www', { recursive: true, force: true });
fs.mkdirSync('www', { recursive: true });
for (const f of ['index.html', 'app.js', 'style.css', 'sw.js', 'manifest.webmanifest']) {
  fs.copyFileSync(f, `www/${f}`);
}
fs.cpSync('icons', 'www/icons', { recursive: true });
fs.cpSync('data', 'www/data', { recursive: true });
const dataFiles = fs.readdirSync('www/data');
const rawJson = dataFiles.filter((f) => f.endsWith('.json'));
if (rawJson.length) throw new Error(`JSON mentah ditemukan di data/ (harusnya .json.gz): ${rawJson.join(', ')}`);
const totalMB = dataFiles.reduce((n, f) => n + fs.statSync(`www/data/${f}`).size, 0) / 1048576;
console.log(`www/ siap (data gzip: ${totalMB.toFixed(1)} MB, ${dataFiles.length} file)`);

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

// 4. Verifikasi keras: assets data hanya boleh berisi .json.gz
const ADIR = 'android/app/src/main/assets/public/data';
const entries = fs.readdirSync(ADIR);
const badRaw = entries.filter((f) => f.endsWith('.json'));
if (badRaw.length) throw new Error(`JSON mentah bocor ke assets Android: ${badRaw.join(', ')}`);
console.log(`assets/data OK: ${entries.filter((f) => f.endsWith('.json.gz')).length} file .json.gz, 0 JSON mentah`);
console.log('Siap di-build: cd android && ./gradlew assembleDebug');
