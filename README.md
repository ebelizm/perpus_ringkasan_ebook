# 📚 Perpustakaan Ringkasan Buku — Offline (PWA)

Aplikasi web offline berisi **4.948 ringkasan buku (±7,1 juta kata)** dari dua situs:

| Sumber | Jumlah | Format |
|---|---|---|
| [f15library.com](https://www.f15library.com/books) | 3.472 ringkasan | Judul + penulis + tagline + 14 kategori + isi lengkap (ID) |
| [rofiatulmaos.com](https://rofiatulmaos.com/buku/) | 1.476 artikel | Artikel ringkasan/tema buku via WordPress REST API |

## 🚀 Cara Menjalankan

```bash
node server.mjs        # atau: npm start
```

Buka **http://localhost:5173**.

## 📲 Instalasi di Android (PWA)

1. Sambungkan HP dan komputer ke jaringan yang sama, lalu jalankan server dengan akses LAN:
   ```bash
   node server.mjs
   ```
   Server mendengarkan di semua interface — cari IP komputer (mis. `192.168.1.10`).
2. Di Chrome Android, buka `http://<IP-KOMPUTER>:5173`
3. Ketuk **⋮ → Tambahkan ke layar utama** (atau banner "Install app")
4. Selesai — aplikasi muncul sebagai ikon 📚, berjalan fullscreen tanpa address bar, 100% offline

> Alternatif: jalankan server langsung di HP dengan Termux (`node server.mjs`) agar tidak perlu PC.

Data status baca (progress, selesai, ukuran huruf) tersimpan di **localStorage** perangkat — tidak ada server, tidak ada akun.

## ✨ Fitur

- 🔍 Pencarian instan judul/penulis + **pencarian isi penuh** (centang "telusuri isi")
- 🏷️ Filter sumber & 15 kategori, urutkan judul/terpanjang
- 📖 **Pelacak baca**: tab `Semua / Dibaca / Selesai`, progress bar otomatis saat scroll, tombol "✓ Tandai selesai"
- 📱 UI mobile-minimalis: grid 2 kolom, target sentuh 44px, safe-area untuk notch, tanpa elemen ramai
- 🔠 Ukuran huruf bisa diatur
- 📲 PWA installable (standalone, portrait, ikon maskable)

## 📁 Struktur

```
index.html            # UI
app.js                # logika + tracking baca (localStorage)
style.css             # tema gelap mobile-first
sw.js                 # service worker (cache-first, v2)
manifest.webmanifest  # manifest PWA
icons/                # ikon PWA (192/512, dibuat via scratch/gen_icons.mjs)
data/
  index.json          # metadata 4.948 buku (~1,9 MB)
  content-0..19.json  # isi lengkap per 250 buku (~2-3 MB/chunk)
server.mjs            # server statis tanpa dependensi
scratch/              # scraper, builder, generator ikon
```

## 🔄 Memperbarui Data

```bash
npm run scrape:f15     # ambil ulang dari f15library.com (~10-15 menit)
npm run scrape:rofia   # ambil ulang dari rofiatulmaos.com (~1 menit)
npm run build:data     # gabungkan → folder data/
node scratch/fix_categories.mjs   # (opsional) perbaiki pemetaan kategori F15
```

Scraper F15 punya checkpoint sehingga bisa dihentikan dan dilanjutkan.
