#!/usr/bin/env node
/* A tiny static server for tools/xr-assets, so the viewer can load three from node_modules and assets from out/ or
   samples/:  node viewer/serve.mjs   (PORT from the environment, default 20901; HOST default 127.0.0.1)
   then open http://127.0.0.1:20901/viewer/?item=boards/uno-r3 */
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.map': 'application/json', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
};

export function startServer({ port = Number(process.env.PORT) || 20901, host = process.env.HOST || '127.0.0.1', quiet = false } = {}) {
  const server = createServer((req, res) => {
    let path;
    try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    if (path === '/' || path === '/viewer') { res.writeHead(302, { location: '/viewer/' }).end(); return; }
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (file !== ROOT && !file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
    let st;
    try { st = statSync(file); } catch { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found: ' + path); return; }
    if (st.isDirectory()) { res.writeHead(302, { location: path + '/' }).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store' });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      const a = server.address();
      if (!quiet) console.log(`xr-assets viewer: http://${host}:${a.port}/viewer/   (serving ${ROOT})`);
      ok(server);
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer().catch((e) => { console.error(e.message); process.exit(1); });
