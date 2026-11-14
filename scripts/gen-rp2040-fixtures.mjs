#!/usr/bin/env node
// Writes the UF2 fixtures the RP2040 engine tests and the e2e load, from the Thumb programs in
// src/sim/mcu/rp2040/programs.testing.ts, so no toolchain is needed.
//
//   node scripts/gen-rp2040-fixtures.mjs [--check]
//
// `--check` builds them in memory and exits 1 when a committed file differs or is missing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtures } from '../src/sim/mcu/rp2040/programs.testing.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'src', 'sim', 'mcu', 'rp2040', 'fixtures');
const check = process.argv.includes('--check');

const stale = [];
for (const [name, bytes] of Object.entries(fixtures())) {
  const file = join(OUT, name);
  const current = existsSync(file) ? readFileSync(file) : null;
  if (current && Buffer.compare(current, bytes) === 0) continue;
  stale.push(name);
  if (!check) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(file, bytes);
  }
}

if (check && stale.length > 0) {
  console.error(`rp2040 fixtures out of date: ${stale.join(', ')} (run node scripts/gen-rp2040-fixtures.mjs)`);
  process.exit(1);
}
console.log(check ? 'rp2040 fixtures are up to date' : `rp2040 fixtures written: ${stale.length} changed`);
