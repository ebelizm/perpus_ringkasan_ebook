// Hitung versi Android dan terapkan ke build.gradle.
//
// Dipisah dari prepare-android.mjs supaya bisa diuji tanpa menjalankan
// `npx cap add` + Gradle. android/ dibuat ulang tiap run dari template
// Capacitor yang selalu memuat versionCode 1, sehingga tanpa patch ini setiap
// APK terbaca sebagai versi yang sama.
import { execSync } from 'child_process';

// Commit count dipakai sebagai versionCode: monoton naik mengikuti riwayat repo
// dan tidak perlu rahasia CI. Env hanya untuk override (mis. mulai dari angka lain).
export function androidVersion(env = process.env) {
  let code;
  if (env.ANDROID_VERSION_CODE !== undefined && env.ANDROID_VERSION_CODE !== '') {
    // Env yang diisi tapi tidak valid harus gagal keras, bukan diam-diam jatuh
    // ke commit count — kalau tidak, kesalahan CI sulit ketahuan.
    code = Number(env.ANDROID_VERSION_CODE);
    if (!Number.isInteger(code) || code < 1 || code > 2100000000) {
      throw new Error(`ANDROID_VERSION_CODE tidak valid: ${env.ANDROID_VERSION_CODE}`);
    }
  } else {
    code = Number(execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim());
    if (!Number.isInteger(code) || code < 1) {
      throw new Error(`git rev-list --count HEAD tidak memberi angka: ${code}`);
    }
  }
  const name = env.ANDROID_VERSION_NAME || `1.0.${code}`;
  return { versionCode: code, versionName: name };
}

export function patchVersion(gradle, { versionCode, versionName }) {
  if (!/versionCode\s+\d+/.test(gradle) || !/versionName\s+"[^"]*"/.test(gradle)) {
    throw new Error('Patch versi gagal — tidak ada versionCode/versionName di build.gradle');
  }
  return gradle
    .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);
}
