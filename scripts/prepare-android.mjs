// Siapkan build Android: ikon → www/ → cap add → ikon native → copy
import fs from 'fs';
import { execSync } from 'child_process';
// Logika versi diekstrak ke modul sendiri supaya bisa diuji tanpa build Android.
import { androidVersion, patchVersion } from './android-version.mjs';

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

// 2c. Rampingkan APK: R8 + shrink resources di build type release.
// APK debug sebelumnya ~40 MB dengan ~11 MB library/aseset tak terpakai.
// Release ditandatangani pakai keystore debug supaya tetap bisa di-install
// tanpa rahasia CI (pengguna tetap uninstall APK lama saat ganti versi).
const GRADLE = 'android/app/build.gradle';
let gradle = fs.readFileSync(GRADLE, 'utf8');
if (!gradle.includes('shrinkResources true')) {
  gradle = gradle
    .replace(/minifyEnabled\s+false/, 'minifyEnabled true')
    .replace(/(proguardFiles[^\n]*\n)/, '$1            shrinkResources true\n            signingConfig signingConfigs.debug\n');
  if (!/minifyEnabled true/.test(gradle) || !/shrinkResources true/.test(gradle)) {
    throw new Error('Patch build.gradle gagal — template Capacitor berubah? Periksa android/app/build.gradle');
  }
  fs.writeFileSync(GRADLE, gradle);
  // Jaga annotate @JavascriptInterface agar R8 tidak membuang bridge Capacitor
  const PRO = 'android/app/proguard-rules.pro';
  if (fs.existsSync(PRO)) {
    const keep = '-keepclassmembers class * {\n    @android.webkit.JavascriptInterface <methods>;\n}\n';
    if (!fs.readFileSync(PRO, 'utf8').includes('JavascriptInterface')) {
      fs.appendFileSync(PRO, '\n' + keep);
    }
  }
  console.log('build.gradle: R8 + shrink resources aktif untuk release');
}

// 2d. Naikkan versi Android (lihat scripts/android-version.mjs)
const version = androidVersion();
fs.writeFileSync(GRADLE, patchVersion(gradle, version));
console.log(`build.gradle: versionCode ${version.versionCode} / versionName ${version.versionName}`);

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
