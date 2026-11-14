import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { repoAliases, repoRoot } from './vite.aliases';

/**
 * `./xr-assets/`, the asset pipeline's items (docs/XR_ASSETS.md): `tools/xr-assets/out/` once it has been built
 * (`npm run xr:assets` at the repo root), else the committed `tools/xr-assets/samples/`. Served in dev, copied into
 * `dist/xr-assets/` at build.
 */
function xrAssets(): Plugin {
  const pipeline = resolve(repoRoot, 'tools/xr-assets');
  const folder = () => join(pipeline, existsSync(join(pipeline, 'out/index.json')) ? 'out' : 'samples');
  const TYPES: Record<string, string> = { '.json': 'application/json', '.glb': 'model/gltf-binary' };
  let outDir = '';
  return {
    name: 'iynkware-xr-assets',
    configResolved(config) {
      if (config.command === 'build') outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/xr-assets', (req, res) => {
        const root = folder();
        const file = resolve(root, `.${decodeURIComponent((req.url ?? '/').split('?')[0]!)}`);
        const ok = file.startsWith(root + sep) && existsSync(file) && statSync(file).isFile();
        if (!ok) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (outDir) cpSync(folder(), join(outDir, 'xr-assets'), { recursive: true });
    },
  };
}

export default defineConfig(({ mode }) => {
  // `--mode http` serves plain HTTP for the headset over `adb reverse` (localhost is a secure context there).
  const http = mode === 'http';
  return {
    // Relative, so the same build works at the root of the Cloudflare deploy (docs/XR_DEPLOY.md) and later under /xr/
    // on the 2D site's origin.
    base: './',
    plugins: [
      xrAssets(),
      iwsdkDev({
        emulator: { device: 'metaQuest3' },
        https: !http,
        verbose: false,
        // Never launch the plugin's managed Playwright browser (it downloads a Chromium and evicts cached ones).
        workspace: { enabled: false, open: false },
      }),
    ],
    resolve: {
      alias: repoAliases,
      dedupe: ['three'],
    },
    server: { host: 'localhost', port: 8081, strictPort: true, open: false, fs: { allow: [repoRoot] } },
    preview: { host: 'localhost', port: 8082, strictPort: true },
    worker: { format: 'es' },
    build: { outDir: 'dist', target: 'esnext', sourcemap: false, chunkSizeWarningLimit: 4096 },
    esbuild: { target: 'esnext' },
    optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  };
});
