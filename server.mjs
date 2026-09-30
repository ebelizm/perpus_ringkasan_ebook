// Server statis mini tanpa dependensi — jalankan: node server.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5173;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.gz': 'application/gzip',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }

  // gzip: sajikan file .gz bila ada & client mendukung (data APK terkompresi)
  const acceptsGzip = /gzip/.test(String(req.headers['accept-encoding'] || ''));
  const gzPath = acceptsGzip && file.endsWith('.json') ? file + '.gz' : null;
  if (gzPath && fs.existsSync(gzPath)) {
    return fs.readFile(gzPath, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, {
        'Content-Type': MIME['.json'],
        'Content-Encoding': 'gzip',
        'Cache-Control': 'no-cache',
      });
      res.end(buf);
    });
  }

  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404 Not Found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}).listen(PORT, () => {
  console.log(`Perpustakaan Ringkasan siap → http://localhost:${PORT}`);
});
