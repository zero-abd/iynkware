import { defineConfig } from 'vitest/config';
import { repoAliases } from './vite.aliases';

/** Headless tests: the sim runs inline in Node, no browser and no headset. */
export default defineConfig({
  resolve: { alias: repoAliases },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
