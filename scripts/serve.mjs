#!/usr/bin/env node
// Tiny static server for previewing dist/ (development only; production is nginx).
//   node scripts/serve.mjs [port]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.argv[2] || process.env.PORT || 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
};
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const nf = path.join(ROOT, '404.html');
    res.writeHead(404, { 'content-type': TYPES['.html'] });
    return res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`serving dist/ on http://localhost:${PORT}`));
