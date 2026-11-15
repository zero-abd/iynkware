// The bundle budget, run after `vite build` (npm run build). Reads dist/ and exits 1 when
//   - the entry chunk (the module script in dist/index.html) is 3 MB or more,
//   - any chunk is 3 MB or more, except Rapier's (a wasm blob the sim worker loads on demand),
//   - the eager graph (entry plus static imports, transitively) is over EAGER_TOTAL_MAX,
//   - the firmware engines (avr8js, rp2040js) or Rapier code appears in any chunk the main thread can load (the entry
//     plus everything reachable through static or dynamic imports). They belong in the sim worker's chunks, or in lazy
//     chunks only the worker imports; Rapier is imported dynamically by xr/src/sim/handler-deps.ts.
//
//   node scripts/bundle-budget.mjs [dist-dir]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MB = 1024 * 1024;
const CHUNK_MAX = 3 * MB;
const EAGER_TOTAL_MAX = 8 * MB;

// Strings that survive minification and only exist in the engine's own code (not in part descriptions or docs).
const MARKERS = {
  avr8js: ['Invalid prescaler value!', 'BREAK instruction encountered'],
  rp2040js: ['VREG_AND_CHIP_RESET_BASE', 'Unimplemented Timer Pause'],
  rapier: ['rapier_wasm3d'],
};

const dist = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entrySrc = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)?.[1];
if (!entrySrc) {
  console.error('bundle-budget: no module script in dist/index.html');
  process.exit(1);
}

const rel = (p) => p.replace(/^\.\//, '');
const entry = rel(entrySrc);

/** Static `import ... from "./x.js"`, `import "./x.js"` and `export ... from "./x.js"` (not `import("./x.js")`). */
function staticImports(code, file) {
  const out = new Set();
  const re = /(?:^|[;}\s])(?:import|export)\s*(?:[^'"();]*?\bfrom\s*)?["'](\.{1,2}\/[^"']+\.js)["']/g;
  for (const m of code.matchAll(re)) out.add(rel(join(dirname(file), m[1])));
  return out;
}

/** Dynamic `import("./x.js")`. */
function dynamicImports(code, file) {
  const out = new Set();
  for (const m of code.matchAll(/\bimport\(\s*["'](\.{1,2}\/[^"']+\.js)["']\s*\)/g)) out.add(rel(join(dirname(file), m[1])));
  return out;
}

function reach(withDynamic) {
  const seen = new Map(); // path relative to dist -> code
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    const code = readFileSync(join(dist, file), 'utf8');
    seen.set(file, code);
    for (const dep of staticImports(code, file)) queue.push(dep);
    if (withDynamic) for (const dep of dynamicImports(code, file)) queue.push(dep);
  }
  return seen;
}
const eager = reach(false);
const mainThread = reach(true);

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const failures = [];
let total = 0;
console.log(`bundle-budget: entry ${entry}`);
for (const [file] of [...eager].sort((a, b) => b[1].length - a[1].length)) {
  const size = statSync(join(dist, file)).size;
  total += size;
  console.log(`  eager  ${kb(size).padStart(9)}  ${file}${file === entry ? '  (entry)' : ''}`);
}
console.log(`main thread can also load ${mainThread.size - eager.size} more chunks lazily`);
for (const [file, code] of mainThread) {
  for (const [engine, strings] of Object.entries(MARKERS)) {
    const hit = strings.find((s) => code.includes(s));
    if (hit) failures.push(`${engine} code is in ${file}, which the main thread can load (found "${hit}")`);
  }
}
for (const name of readdirSync(join(dist, 'assets'))) {
  if (!name.endsWith('.js') || name.startsWith('rapier-')) continue;
  const size = statSync(join(dist, 'assets', name)).size;
  if (size >= CHUNK_MAX) failures.push(`assets/${name} is ${kb(size)}, a chunk must stay under ${kb(CHUNK_MAX)}`);
}
console.log(`  eager total ${kb(total)} (limit ${kb(EAGER_TOTAL_MAX)})`);
if (total >= EAGER_TOTAL_MAX) failures.push(`eager total ${kb(total)} is over ${kb(EAGER_TOTAL_MAX)}`);

let all = 0;
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else all += s.size;
  }
};
walk(dist);
console.log(`  dist total ${kb(all)}`);

if (failures.length) {
  for (const f of failures) console.error(`bundle-budget FAIL: ${f}`);
  process.exit(1);
}
console.log('bundle-budget: ok');
