# Ringgo Book — Ringkasan Buku Offline (PWA + Android)

Aplikasi web offline berisi **4.879 ringkasan buku (±11,3 juta kata)** dari dua situs:

| Sumber | Jumlah | Format |
|---|---|---|
| [f15library.com](https://www.f15library.com/books) | 3.472 ringkasan | Judul + penulis + tagline + 14 kategori + isi lengkap (ID) |
| [rofiatulmaos.com](https://rofiatulmaos.com/buku/) | 1.407 ringkasan | Artikel ringkasan/tema buku via WordPress REST API (artikel per-bagian sudah dilebur ke buku induk) |

## Cara Menjalankan

```bash
node server.mjs        # atau: npm start
```

Buka **http://localhost:5173**.

## Instalasi di Android

**Cara 1 — APK** (disarankan): unduh `app-release.apk` dari [release `apk`](https://github.com/ebelizm/perpus_ringkasan_ebook/releases/latest), lalu install (izinkan "sumber tidak dikenal"). Release ini selalu ditimpa dengan build terbaru, jadi satu link itu cukup.

Mengganti versi: **uninstall APK lama dulu, baru pasang yang baru**. APK ditandatangani keystore debug (dijalankan otomatis di CI, tanpa rahasia yang harus disimpan), dan Android menolak menimpa APK dengan tanda tangan berbeda — data baca di localStorage ikut terhapus bersama aplikasinya, jadi progress hilang saat mengganti versi.

**Cara 2 — PWA**: jalankan `node server.mjs`, buka `http://<IP-KOMPUTER>:5173` dari Chrome Android, ketuk **⋮ → Tambahkan ke layar utama**.

Semua status baca (progress, selesai, tema, ukuran huruf) tersimpan di **localStorage** perangkat — tanpa server, tanpa akun, 100% offline.

## Fitur

- Pencarian instan judul/penulis + **pencarian isi penuh** (centang "telusuri isi" — 11 juta kata)
- Filter sumber & 15 kategori, urutkan judul/terpanjang
- **Pelacak baca**: tab `Semua / Dibaca / Selesai`, progress otomatis saat scroll, tombol tandai selesai
- **Tema terang/sepia/gelap minimalis** (siklus lewat tombol; awal mengikuti preferensi sistem, tersimpan; kontras WCAG AA)
- Tipografi editorial serif untuk isi buku; UI monokrom hangat dengan aksen emerald
- **Strip "Lanjutkan membaca"** dengan cincin progres + lanjut otomatis dari posisi terakhir di reader
- Cover buku monogram tipografis (hue konsisten per judul) + cincin progres di sudut kartu
- Dock navigasi melayang di thumb zone dengan badge hitungan, segmented pill dengan indikator geser
- Grid mobile 3 kolom ala rak buku, target sentuh 44–56px, safe-area untuk notch
- PWA installable (standalone, portrait, ikon maskable) + APK Android via Capacitor
- Data APK terkompresi gzip (93 MB → 28 MB), dibuka langsung via DecompressionStream

## Struktur

```
index.html            # UI (ikon SVG, toggle tema)
app.js                # logika + tracking baca (localStorage)
style.css             # palet light/dark monokrom hangat (data-theme)
sw.js                 # service worker (cache-first, v3)
manifest.webmanifest  # manifest PWA
icons/                # ikon PWA (192/512)
data/
  index.json          # metadata semua buku (~2 MB)
  content-0..19.json  # isi lengkap per 250 buku
server.mjs            # server statis tanpa dependensi
scripts/prepare-android.mjs  # siapkan project Capacitor + ikon native
scratch/              # scraper, builder, refresh incremental
```

## Memperbarui Data

**Otomatis (disarankan):** workflow **Weekly Data Refresh** (`.github/workflows/refresh-data.yml`) berjalan tiap Senin 02:00 UTC — mengambil buku baru dari sitemap F15 + artikel baru/berubah dari WP API Rofia (incremental), recheck rotasi 5% katalog F15 per pekan, lalu commit + push yang otomatis memicu build APK baru.

**Manual:**

```bash
node scratch/refresh_data.mjs   # incremental + rebuild data/ (buku baru + perubahan konten)
# atau lengkap dari nol:
npm run scrape:f15 && npm run scrape:rofia && node scratch/merge_parts.mjs && npm run build:data
```

## Build APK

Push ke `main` memicu workflow **Build APK** (`.github/workflows/build-apk.yml`). Hasilnya dikirim ke dua tempat:

- Release [`apk`](https://github.com/ebelizm/perpus_ringkasan_ebook/releases/latest) — link unduh yang stabil, selalu berisi build terbaru (artifact Actions sendiri kedaluwarsa setelah 90 hari)
- Tab Actions sebagai artifact `perpustakaan-ringkasan-apk`

`versionCode` APK diambil dari jumlah commit di `main` (`scripts/android-version.mjs`), jadi selalu naik seiring commit baru dan Android memperlakukan build berikutnya sebagai upgrade, bukan duplikat.
