// The committed samples (tools/xr-assets/samples) are valid and are exactly what the converter makes now, so the app
// can load them without running the converter. After a converter or figure change: node build.mjs --samples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SAMPLES, buildItems } from '../build.mjs';
import { validateGlb, sidecarErrors } from './validate.mjs';

const DIR = join(import.meta.dirname, '..', 'samples');

test('every committed sample is a valid glb with a schema-clean sidecar', async () => {
  const index = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8'));
  assert.deepEqual(index.items.map((i) => i.id).sort(), [...SAMPLES].sort());
  for (const it of index.items) {
    const side = JSON.parse(readFileSync(join(DIR, it.sidecar), 'utf8'));
    assert.deepEqual(sidecarErrors(side), [], it.id);
    assert.equal(side.glb, it.glb.split('/').pop(), it.id);
    const report = await validateGlb(readFileSync(join(DIR, it.glb)), it.glb);
    assert.equal(report.errors, 0, `${it.id}: ${JSON.stringify(report.issues.slice(0, 3))}`);
  }
});

test('the committed samples are current: a fresh build gives the same bytes', async () => {
  const out = mkdtempSync(join(tmpdir(), 'xr-samples-'));
  try {
    const rows = await buildItems(SAMPLES, out, { log: () => {} });
    assert.deepEqual(rows.filter((r) => r.error), []);
    for (const item of SAMPLES) {
      for (const ext of ['json', 'glb']) {
        const a = readFileSync(join(DIR, `${item}.${ext}`)), b = readFileSync(join(out, `${item}.${ext}`));
        assert.ok(a.equals(b), `${item}.${ext} is stale: run node build.mjs --samples`);
      }
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
});
