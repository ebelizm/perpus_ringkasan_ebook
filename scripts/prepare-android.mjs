// Siapkan build Android: ikon → www/ → cap add → ikon native → copy
import fs from 'fs';
import { execSync } from 'child_process';

// 0. Generate ikon + splash (assets/icon.png, assets/splash.png, icons/)
execSync('node scratch/gen_icons.mjs', { stdio: 'inherit' });

// 1. Salin web app + semua data ke www/
fs.rmSync('www', { recursive: true, force: true });
fs.mkdirSync('www', { recursive: true });
for (const f of ['index.html', 'app.js', 'style.css', 'sw.js', 'manifest.webmanifest']) {
  fs.copyFileSync(f, `www/${f}`);
}
fs.cpSync('icons', 'www/icons', { recursive: true });
fs.cpSync('data', 'www/data', { recursive: true });
const totalMB = fs.readdirSync('www/data').reduce((n, f) => n + fs.statSync(`www/data/${f}`).size, 0) / 1048576;
console.log(`www/ siap (data: ${totalMB.toFixed(1)} MB)`);

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
execSync('npx cap copy android', { stdio: 'inherit' });
console.log('Siap di-build: cd android && ./gradlew assembleDebug');
