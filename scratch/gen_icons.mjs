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

// Logo Ringgo Book: buku dengan cincin emerald (ring + book), aman untuk maskable
function drawRinggo(size, set) {
  const cx = size / 2, cy = size / 2;
  const rOut = size * 0.36, rIn = rOut - Math.max(2, size * 0.045);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= rOut && d >= rIn) set(x, y, 76, 199, 155); // cincin emerald
    }
  }
  const bx0 = Math.round(size * 0.31), bx1 = Math.round(size * 0.69);
  const by0 = Math.round(size * 0.30), by1 = Math.round(size * 0.70);
  const spine = Math.max(2, Math.round((bx1 - bx0) * 0.13));
  const r = Math.max(2, Math.round(size * 0.022));
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const dxl = x - bx0, dxr = bx1 - x, dyt = y - by0, dyb = by1 - y;
      if ((dxl < r && dyt < r && dxl + dyt < r) || (dxr < r && dyt < r && dxr + dyt < r) ||
          (dxl < r && dyb < r && dxl + dyb < r) || (dxr < r && dyb < r && dxr + dyb < r)) continue;
      set(x, y, 245, 243, 236); // halaman
    }
  }
  // punggung emerald
  for (let y = by0 + r; y <= by1 - r; y++) {
    for (let x = bx0 + r; x < bx0 + spine; x++) set(x, y, 15, 157, 118);
  }
  // garis teks pada halaman
  const t = Math.max(1, Math.round(size * 0.012));
  const lx0 = bx0 + spine + Math.round(size * 0.03), lx1 = bx1 - Math.round(size * 0.03);
  for (let i = 0; i < 3; i++) {
    const ly = by0 + Math.round((by1 - by0) * (0.26 + i * 0.2));
    const end = lx0 + Math.round((lx1 - lx0) * (i === 2 ? 0.55 : 0.9));
    for (let y = ly; y < ly + t; y++) for (let x = lx0; x < end; x++) set(x, y, 198, 196, 186);
  }
  // penanda emerald di tepi kanan
  const bmW = Math.max(2, Math.round(size * 0.042));
  const bmX0 = bx1 - spine - bmW * 2;
  for (let y = by0 + r; y < by0 + r + Math.round((by1 - by0) * 0.3); y++) {
    for (let x = bmX0; x < bmX0 + bmW; x++) set(x, y, 15, 157, 118);
  }
}

fs.mkdirSync('icons', { recursive: true });
fs.mkdirSync('assets', { recursive: true });
for (const size of [192, 512]) {
  const buf = makeIcon(size, drawRinggo);
  fs.writeFileSync(`icons/icon-${size}.png`, buf);
  console.log(`icons/icon-${size}.png: ${buf.length} bytes`);
}

// Ikon 1024 untuk Capacitor launcher (assets/icon.png)
const icon1024 = makeIcon(1024, drawRinggo);
fs.writeFileSync('assets/icon.png', icon1024);
console.log('assets/icon.png:', icon1024.length, 'bytes');

// Splash 2732: logo yang sama digambar ulang pada sub-ukuran lalu dipusatkan
const splash = makeIcon(2732, (size, set) => {
  const sub = Math.round(size / 2.8);
  const off = Math.round((size - sub) / 2);
  drawRinggo(sub, (x, y, r, g, b) => set(x + off, y + off, r, g, b));
});
fs.writeFileSync('assets/splash.png', splash);
console.log('assets/splash.png:', splash.length, 'bytes');
console.log('Ikon selesai dibuat.');
