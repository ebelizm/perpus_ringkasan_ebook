// Generator ikon PNG untuk PWA — tanpa dependensi (zlib bawaan Node)
import zlib from 'zlib';
import fs from 'fs';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makeIcon(size, draw) {
  const px = Buffer.alloc(size * size * 3);
  const set = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 3;
    px[i] = r; px[i + 1] = g; px[i + 2] = b;
  };
  // latar
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, 15, 17, 21);
  draw(size, set);
  // raw scanlines (filter 0)
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    px.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colortype RGB
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Bentuk: buku tertutup dengan punggung berwarna + pembatas buku, dalam safe-zone maskable
function drawBook(size, set) {
  const bx0 = Math.round(size * 0.30), bx1 = Math.round(size * 0.70);
  const by0 = Math.round(size * 0.24), by1 = Math.round(size * 0.76);
  const spineW = Math.round((bx1 - bx0) * 0.14);
  const r = Math.max(3, Math.round(size * 0.028));
  const cut = (x, y) => {
    const dxl = x - bx0, dxr = bx1 - x, dyt = y - by0, dyb = by1 - y;
    return (dxl < r && dyt < r && dxl + dyt < r) ||
           (dxr < r && dyt < r && dxr + dyt < r) ||
           (dxl < r && dyb < r && dxl + dyb < r) ||
           (dxr < r && dyb < r && dxr + dyb < r);
  };
  const bmW = Math.round((bx1 - bx0) * 0.10);
  const bmX0 = bx1 - spineW - bmW * 2, bmX1 = bmX0 + bmW;
  const bmY1 = by0 + Math.round((by1 - by0) * 0.26);
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      if (cut(x, y)) continue;
      if (x < bx0 + spineW) set(x, y, 124, 156, 255);        // punggung: accent
      else if (y <= bmY1 && x >= bmX0 && x <= bmX1) {
        // pembatas buku dengan takik V di bawah
        const notch = y > bmY1 - Math.round(size * 0.035) && x > (bmX0 + bmX1) / 2 - Math.round(bmW * 0.3) && x < (bmX0 + bmX1) / 2 + Math.round(bmW * 0.3);
        if (!notch) set(x, y, 95, 212, 168);                  // hijau mint
      } else set(x, y, 240, 243, 248);                        // halaman putih
    }
  }
  // garis halaman tipis di sisi kanan
  const lineX = bx1 - Math.round(size * 0.02);
  for (let y = by0 + r; y <= by1 - r; y++) set(lineX, y, 205, 212, 224);
}

fs.mkdirSync('icons', { recursive: true });
fs.mkdirSync('assets', { recursive: true });
for (const size of [192, 512]) {
  const buf = makeIcon(size, drawBook);
  fs.writeFileSync(`icons/icon-${size}.png`, buf);
  console.log(`icons/icon-${size}.png: ${buf.length} bytes`);
}

// Ikon 1024 untuk Capacitor launcher (assets/icon.png)
const icon1024 = makeIcon(1024, drawBook);
fs.writeFileSync('assets/icon.png', icon1024);
console.log('assets/icon.png:', icon1024.length, 'bytes');

// Splash 2732: latar gelap dengan buku di tengah (untuk @capacitor/assets)
const splash = makeIcon(2732, (size, set) => {
  const s2 = size / 2.8; // gambar ulang bentuk buku pada sub-ukuran, terpusat
  const off = (size - s2) / 2;
  for (let y = 0; y < Math.ceil(s2); y++) {
    for (let x = 0; x < Math.ceil(s2); x++) {
      let r = 0, g = 0, b = 0, hit = false;
      // pantulkan pemanggilan set() ke buffer kecil sederhana
      const orig = set;
      void orig;
      // gambar buku skala kecil manual: gunakan drawBook pada koordinat ter-offset
      hit = false;
      void r; void g; void b;
      set(Math.floor(x + off), Math.floor(y + off), 0, 0, 0); // placeholder overwritten below
    }
  }
  // gambar ulang: buku pada skala 2.8x lebih kecil, warna sesuai drawBook
  const bx0 = Math.round(off + s2 * 0.30), bx1 = Math.round(off + s2 * 0.70);
  const by0 = Math.round(off + s2 * 0.24), by1 = Math.round(off + s2 * 0.76);
  const spineW = Math.max(2, Math.round((bx1 - bx0) * 0.14));
  const rr = Math.max(2, Math.round(s2 * 0.028));
  const cut = (x, y) => {
    const dxl = x - bx0, dxr = bx1 - x, dyt = y - by0, dyb = by1 - y;
    return (dxl < rr && dyt < rr && dxl + dyt < rr) || (dxr < rr && dyt < rr && dxr + dyt < rr) ||
           (dxl < rr && dyb < rr && dxl + dyb < rr) || (dxr < rr && dyb < rr && dxr + dyb < rr);
  };
  const bmW = Math.round((bx1 - bx0) * 0.10);
  const bmX0 = bx1 - spineW - bmW * 2, bmX1 = bmX0 + bmW;
  const bmY1 = by0 + Math.round((by1 - by0) * 0.26);
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      if (cut(x, y)) continue;
      if (x < bx0 + spineW) set(x, y, 124, 156, 255);
      else if (y <= bmY1 && x >= bmX0 && x <= bmX1) {
        const notch = y > bmY1 - Math.round(s2 * 0.035) && x > (bmX0 + bmX1) / 2 - Math.round(bmW * 0.3) && x < (bmX0 + bmX1) / 2 + Math.round(bmW * 0.3);
        if (!notch) set(x, y, 95, 212, 168);
      } else set(x, y, 240, 243, 248);
    }
  }
});
fs.writeFileSync('assets/splash.png', splash);
console.log('assets/splash.png:', splash.length, 'bytes');
console.log('Ikon selesai dibuat.');
