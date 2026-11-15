#!/usr/bin/env node
// The XR asset converter (docs/XR_ASSETS.md). Builds every figure item, or the ones named, into
// <out>/<dir>/<id>.glb + .json and <out>/index.json, and prints a table.
//
//   node build.mjs                          every item into tools/xr-assets/out
//   node build.mjs boards/uno-r3 drones/quad5
//   node build.mjs --out ../../public/xr-assets
//   node build.mjs --samples                the committed samples (tools/xr-assets/samples)
//   node build.mjs --check                  exit 1 if an asset in out/ is missing or older than its figure
//   node build.mjs --kind boards
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { convert, VERSION } from './capture/assemble.mjs';
import { ROOT, TOOL, buildPage } from './capture/page.mjs';
import { adapterFor } from './capture/adapters.mjs';

export const DIRS = ['boards', 'parts', 'modules', 'robotics', 'drones', 'flight'];
// the Blink scene (an Uno, a half breadboard, an LED, a resistor, a wire) and one drone, committed so the app can load
// real assets without running the converter
export const SAMPLES = ['boards/uno-r3', 'parts/breadboard', 'parts/led', 'parts/resistor', 'parts/wire', 'drones/quad5', 'drones/racer', 'drones/whoop', 'drones/cinewhoop', 'drones/longrange', 'drones/tricopter'];
const BUDGET = { part: [12000, 12], board: [40000, 32], module: [40000, 32], bench: [150000, 96], drone: [80000, 64], flight: [60000, 24] };

/** Every figure item: figures/<dir>/<id>.js for the six item folders. */
export function allItems() {
  const out = [];
  for (const dir of DIRS) {
    const p = join(ROOT, 'figures', dir);
    if (!existsSync(p)) continue;
    for (const f of readdirSync(p).sort()) if (/^[a-z0-9][a-z0-9-]*\.js$/.test(f)) out.push(`${dir}/${f.slice(0, -3)}`);
  }
  return out;
}

function parseArgs(argv) {
  const o = { out: join(TOOL, 'out'), items: [], check: false, quiet: false, kind: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = resolve(argv[++i]);
    else if (a === '--samples') { o.out = join(TOOL, 'samples'); o.items.push(...SAMPLES); }
    else if (a === '--check') o.check = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--kind') o.kind = argv[++i];
    else o.items.push(a);
  }
  if (!o.items.length) o.items = allItems().filter((it) => !o.kind || it.startsWith(o.kind + '/'));
  return o;
}

export async function buildItems(items, outDir, { log = console.log } = {}) {
  const rows = [], index = { schema: 'iynkware.xr-asset-index/1', generator: { tool: 'tools/xr-assets', version: VERSION }, items: [] };
  const old = existsSync(join(outDir, 'index.json')) ? JSON.parse(readFileSync(join(outDir, 'index.json'), 'utf8')) : null;
  for (const item of items) {
    const adapter = adapterFor(item);
    if (!adapter) { rows.push({ item, error: 'no engine adapter' }); continue; }
    try {
      const { glb, sidecar } = await convert(item, adapter, { log: () => {} });
      const [dir, id] = item.split('/');
      mkdirSync(join(outDir, dir), { recursive: true });
      writeFileSync(join(outDir, dir, `${id}.glb`), glb);
      writeFileSync(join(outDir, dir, `${id}.json`), JSON.stringify(sidecar, null, 1) + '\n');
      const s = sidecar.stats, [bt, bd] = BUDGET[sidecar.kind] || [Infinity, Infinity];
      if (s.triangles > bt) sidecar.warnings.push(`over the ${sidecar.kind} budget: ${s.triangles} triangles (budget ${bt})`);
      if (s.drawCalls > bd) sidecar.warnings.push(`over the ${sidecar.kind} budget: ${s.drawCalls} draw calls (budget ${bd})`);
      if (sidecar.warnings.length) writeFileSync(join(outDir, dir, `${id}.json`), JSON.stringify(sidecar, null, 1) + '\n');
      index.items.push({ id: item, kind: sidecar.kind, name: sidecar.name, glb: `${dir}/${id}.glb`, sidecar: `${dir}/${id}.json`, triangles: s.triangles, drawCalls: s.drawCalls,
        anchors: sidecar.anchors.length, channels: sidecar.channels.length, warnings: sidecar.warnings.length });
      rows.push({ item, tris: s.triangles, draws: s.drawCalls, anchors: sidecar.anchors.length, channels: sidecar.channels.length, warnings: sidecar.warnings.length, kb: Math.round(s.bytes / 1024), w: sidecar.warnings });
    } catch (e) {
      rows.push({ item, error: String(e && e.message || e).split('\n')[0] });
    }
    log(row(rows[rows.length - 1]));
  }
  // keep entries for items not rebuilt this run
  if (old) for (const it of old.items) if (!index.items.some((x) => x.id === it.id) && existsSync(join(outDir, it.glb))) index.items.push(it);
  index.items.sort((a, b) => a.id.localeCompare(b.id));
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1) + '\n');
  return rows;
}

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
export const header = () => `${pad('item', 30)}${lpad('triangles', 10)}${lpad('draws', 7)}${lpad('anchors', 9)}${lpad('channels', 10)}${lpad('warnings', 10)}${lpad('KB', 7)}`;
const row = (r) => r.error ? `${pad(r.item, 30)}  FAILED: ${r.error}` : `${pad(r.item, 30)}${lpad(r.tris, 10)}${lpad(r.draws, 7)}${lpad(r.anchors, 9)}${lpad(r.channels, 10)}${lpad(r.warnings, 10)}${lpad(r.kb, 7)}`;

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.check) {
    const bad = [];
    for (const item of o.items) {
      const [dir, id] = item.split('/'), f = join(o.out, dir, `${id}.json`);
      if (!existsSync(f)) { bad.push(`${item}: missing`); continue; }
      const side = JSON.parse(readFileSync(f, 'utf8'));
      if (side.source.pageSha256 !== buildPage(item).sha256) bad.push(`${item}: stale (the figure page changed)`);
    }
    for (const b of bad) console.log(b);
    console.log(bad.length ? `${bad.length} of ${o.items.length} assets need a rebuild` : `all ${o.items.length} assets are current`);
    process.exit(bad.length ? 1 : 0);
  }
  console.log(header());
  const t0 = Date.now();
  const rows = await buildItems(o.items, o.out);
  const ok = rows.filter((r) => !r.error), failed = rows.filter((r) => r.error), clean = ok.filter((r) => !r.warnings);
  const sum = (k) => ok.reduce((s, r) => s + r[k], 0);
  console.log('-'.repeat(83));
  console.log(`${pad(`${ok.length} built, ${failed.length} failed`, 30)}${lpad(sum('tris'), 10)}${lpad(sum('draws'), 7)}${lpad(sum('anchors'), 9)}${lpad(sum('channels'), 10)}${lpad(sum('warnings'), 10)}${lpad(sum('kb'), 7)}`);
  console.log(`${clean.length} of ${rows.length} items convert with no warning; ${((Date.now() - t0) / 1000).toFixed(1)} s; written to ${o.out}`);
  if (!o.quiet) for (const r of ok) for (const w of r.w) console.log(`  ${r.item}: ${w}`);
  process.exit(failed.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
