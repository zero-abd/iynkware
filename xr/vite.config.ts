import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';
import { repoAliases, repoRoot } from './vite.aliases';

export default defineConfig(({ mode }) => {
  // `--mode http` serves plain HTTP for the headset over `adb reverse` (localhost is a secure context there).
  const http = mode === 'http';
  return {
    // Relative, so the same build works at the root of the Cloudflare deploy (docs/XR_DEPLOY.md) and later under /xr/
    // on the 2D site's origin.
    base: './',
    plugins: [
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
