import { fileURLToPath } from 'node:url';

/** The repository root: iynk's pure TypeScript is imported from here (never copied). */
export const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** `@/` is iynk's `src/`, `@content/` its committed project templates. Shared by vite.config.ts and vitest.config.ts. */
export const repoAliases = [
  { find: /^@\//, replacement: `${repoRoot}src/` },
  { find: /^@content\//, replacement: `${repoRoot}content/` },
];
