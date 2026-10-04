// Tes logika versi Android: template Capacitor (versionCode 1) harus naik,
// env harus dipakai, dan input tidak valid harus ditolak.
import { execSync } from 'child_process';
import { androidVersion, patchVersion } from '../scripts/android-version.mjs';

let fail = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name}: ${e.message}`);
  }
};
const eq = (a, b, msg) => {
  if (a !== b) throw new Error(`${msg}: dapat ${JSON.stringify(a)}, harap ${JSON.stringify(b)}`);
};

const TEMPLATE = `android {
    compileSdkVersion 35
    defaultConfig {
        applicationId "com.perpustakaan.ringkasan"
        minSdkVersion 23
        targetSdkVersion 35
        versionCode 1
        versionName "1.0"
    }
    compileOptions { minifyEnabled false }
    proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
}`;

console.log('android-version:');

check('commit count dipakai saat env kosong', () => {
  const v = androidVersion({});
  const commits = Number(execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim());
  eq(v.versionCode, commits, 'versionCode');
  eq(v.versionName, `1.0.${commits}`, 'versionName');
});

check('template versionCode 1 -> naik ke commit count', () => {
  const v = androidVersion({});
  const out = patchVersion(TEMPLATE, v);
  if (out.includes('versionCode 1\n')) throw new Error('versionCode tidak naik');
  if (!out.includes(`versionCode ${v.versionCode}`)) throw new Error('versionCode baru tidak ada');
  if (!out.includes(`versionName "1.0.${v.versionCode}"`)) throw new Error('versionName baru tidak ada');
  if (!out.includes("applicationId \"com.perpustakaan.ringkasan\"")) throw new Error('applicationId rusak');
  if (!out.includes("compileSdkVersion 35")) throw new Error('baris lain rusak');
  if (!out.includes("proguard-rules.pro")) throw new Error('proguardFiles rusak');
});

check('patch idempoten (aman dijalankan ulang)', () => {
  const v = androidVersion({});
  const once = patchVersion(TEMPLATE, v);
  eq(patchVersion(once, v), once, 'kedua patch');
});

check('env menimpa dan naik monoton', () => {
  const a = androidVersion({ ANDROID_VERSION_CODE: '500' });
  eq(a.versionCode, 500, 'versionCode');
  eq(a.versionName, '1.0.500', 'versionName');
  const b = androidVersion({ ANDROID_VERSION_CODE: '501', ANDROID_VERSION_NAME: '2.0' });
  eq(b.versionName, '2.0', 'versionName custom');
  if (!(b.versionCode > a.versionCode)) throw new Error('tidak monoton');
});

check('versionCode 0 / NaN ditolak', () => {
  for (const bad of ['0', 'abc', '-1', '2100000001']) {
    let threw = false;
    try {
      androidVersion({ ANDROID_VERSION_CODE: bad });
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`${bad} diterima, seharusnya ditolak`);
  }
});

check('build.gradle tanpa versionCode ditolak (bukan diam-diam gagal)', () => {
  let threw = false;
  try {
    patchVersion('android { compileSdkVersion 35 }', androidVersion({}));
  } catch {
    threw = true;
  }
  if (!threw) throw new Error('patch diam-diam tidak mengubah apa pun');
});

console.log(fail ? `\n${fail} tes gagal` : '\nsemua tes lulus');
process.exit(fail ? 1 : 0);
