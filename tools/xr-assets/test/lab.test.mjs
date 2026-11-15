// The lab adapter (docs/XR_ASSETS.md sections 2, 5, 7; docs/FIGURES-LAB.md section 8): every lab item converts, its
// sidecar is schema-clean and its glb valid; its anchors are the item's declared xr anchors mapped through the
// sidecar's frame.fromSource (item mm, board-mm frame) with unit normals; every channel is one of the four kinds and
// names a node the glb has; the bench supply's terminals are on its front face (+Z) and its knobs, lamps and rocker
// are channels with nodes; the burner's flame has its node; a glassware liquid has its own static node with the item's
// liquid extras, and its glass a translucent one; the tutor notes ride in extras.lab; bounds match the item's foot; the lab budget holds.
// node --test test/lab.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { convert } from '../capture/assemble.mjs';
import { adapterFor } from '../capture/adapters.mjs';
import { ROOT } from '../capture/page.mjs';
import { allItems } from '../build.mjs';
import { validateGlb, sidecarErrors } from './validate.mjs';

const MM = 0.001;
const BUDGET = { triangles: 20000, drawCalls: 16 };
const CATALOGUE = JSON.parse(readFileSync(join(ROOT, 'figures', 'lab', 'catalogue.json'), 'utf8'));
const ITEMS = CATALOGUE.items.map((c) => `lab/${c.id}`);
const results = new Map();
const converted = (item) => { if (!results.has(item)) results.set(item, convert(item, adapterFor(item))); return results.get(item); };
const declared = (item) => CATALOGUE.items.find((c) => `lab/${c.id}` === item);
/** fromSource (column-major 4x4) applied to an item-mm point, and to a direction */
const apply = (m, [x, y, z]) => [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
const turn = (m, [x, y, z]) => { const v = [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z), l = Math.hypot(...v); return v.map((c) => c / l); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const nodeNames = (glb) => { const n = glb.readUInt32LE(12); return JSON.parse(glb.subarray(20, 20 + n).toString('utf8')).nodes.map((q) => q.name); };
// the channel ids the schema allows; the lab's flame: and swing: are written in these (extras.labId keeps the lab id)
const SIDECAR_ID = (c) => (/^(led|servo|prop|motor|press|turn):/.test(c.id) ? c.id : `${{ flame: 'led', swing: 'turn' }[c.id.split(':')[0]]}:${c.part}`);

test('every lab item is found by the converter and has the lab adapter', () => {
  const all = allItems().filter((i) => i.startsWith('lab/'));
  assert.deepEqual(all.sort(), [...ITEMS].sort());
  assert.equal(ITEMS.length, 6);
  for (const item of ITEMS) assert.equal(adapterFor(item).engine, 'bench', item);
});

for (const item of ITEMS) {
  test(`${item}: valid glb, schema-clean sidecar, declared anchors and channels in the asset frame`, async () => {
    const { glb, sidecar: s } = await converted(item);
    const c = declared(item);
    assert.deepEqual(sidecarErrors(s), [], 'schema');
    const report = await validateGlb(glb, `${item}.glb`);
    assert.equal(report.errors, 0, JSON.stringify(report.issues.slice(0, 3)));
    assert.equal(s.kind, 'lab');
    assert.equal(s.source.engine, 'bench');
    assert.equal(s.frame.source, 'board-mm');
    assert.equal(s.frame.origin, 'footprint-centre');
    assert.equal(s.name, c.name);
    // budget
    assert.ok(s.stats.triangles <= BUDGET.triangles, `${s.stats.triangles} triangles`);
    assert.ok(s.stats.drawCalls <= BUDGET.drawCalls, `${s.stats.drawCalls} draw calls`);
    assert.ok(!s.warnings.some((w) => /budget/.test(w)), 'no budget warning');
    // bounds: on the mat (y = 0 at its top), centred, within the item's foot (which also holds room for what moves: the
    // pendulum's swing, the lit flame) and filling a good part of it
    const size = [0, 1, 2].map((k) => s.bounds.max[k] - s.bounds.min[k]);
    const foot = [c.foot[0], c.foot[2], c.foot[1]].map((v) => v * MM);       // asset X = width, Y = height, Z = depth
    assert.ok(Math.abs(s.bounds.min[1]) <= 0.5 * MM, `stands on the mat: min y ${s.bounds.min[1]}`);
    for (const k of [0, 2]) assert.ok(Math.abs(s.bounds.min[k] + s.bounds.max[k]) <= 0.01 * MM, `centred on ${'XYZ'[k]}`);
    for (let k = 0; k < 3; k++) {
      assert.ok(size[k] <= foot[k] + 1 * MM, `${'XYZ'[k]} ${size[k].toFixed(4)} m within foot ${foot[k]}`);
      assert.ok(size[k] >= 0.4 * foot[k], `${'XYZ'[k]} ${size[k].toFixed(4)} m fills foot ${foot[k]}`);
    }
    // anchors: every declared one, at the declared item-mm point through fromSource, with a unit normal
    const A = new Map(s.anchors.map((a) => [a.id, a]));
    assert.equal(s.anchors.length, c.anchors.length);
    for (const d of c.anchors) {
      const a = A.get(d.id);
      assert.ok(a, `anchor ${d.id}`);
      assert.equal(a.kind, d.kind, d.id);
      assert.equal(a.part, d.part, d.id);
      assert.ok(dist(a.position, apply(s.frame.fromSource, d.at)) <= 0.002 * MM, `${d.id} at ${a.position}`);
      assert.ok(Math.abs(Math.hypot(...a.normal) - 1) < 1e-5, `${d.id} unit normal`);
      assert.ok(dist(a.normal, turn(s.frame.fromSource, d.normal)) < 1e-5, `${d.id} normal ${a.normal}`);
      if (d.channel) assert.equal(a.channel, SIDECAR_ID(c.channels.find((q) => q.id === d.channel)), `${d.id} channel`);
    }
    // channels: the four kinds, each with a node of its own in the glb, every declared one present
    const nodes = new Set(nodeNames(glb));
    assert.equal(s.channels.length, c.channels.length, 'every declared channel converts');
    for (const ch of s.channels) {
      assert.ok(['emissive', 'rotate', 'spin', 'translate'].includes(ch.kind), ch.id);
      assert.deepEqual(ch.nodes, [ch.id], `${ch.id} has its own node`);
      for (const n of ch.nodes) assert.ok(nodes.has(n), `glb node ${n}`);
      assert.ok(s.layers.find((l) => l.id === 'base').nodes.includes(ch.id), `${ch.id} in the base layer`);
      const d = c.channels.find((q) => SIDECAR_ID(q) === ch.id);
      assert.ok(d, `${ch.id} is declared`);
      if (d.id !== ch.id) assert.equal(ch.extras.labId, d.id);
      assert.deepEqual(ch.value, d.value, `${ch.id} value`);
      if (ch.kind === 'rotate') {
        assert.ok(dist(ch.axis, turn(s.frame.fromSource, d.axis)) < 1e-5, `${ch.id} axis ${ch.axis}`);
        assert.ok(dist(ch.pivot, apply(s.frame.fromSource, d.pivot)) <= 0.002 * MM, `${ch.id} pivot ${ch.pivot}`);
        assert.ok(Math.abs(ch.scale - d.scale) < 1e-6, `${ch.id} scale ${ch.scale}`);
      }
    }
    // the tutor notes and the item's own extras
    assert.deepEqual(s.extras.lab, { lab: c.lab, summary: c.summary, safeUse: c.safeUse, hazards: c.hazards, mistakes: c.mistakes });
    for (const [k, v] of Object.entries(c.extras || {})) assert.deepEqual(s.extras[k], v, `extras.${k}`);
    // a part's own nodes exist
    for (const p of s.parts) for (const n of p.nodes || []) assert.ok(nodes.has(n), `part ${p.id} node ${n}`);
  });
}

test('bench power supply: + - GND on the front face, the knobs, lamps and rocker as channels', async () => {
  const { glb, sidecar: s } = await converted('lab/bench-power-supply');
  const A = new Map(s.anchors.map((a) => [a.id, a])), nodes = new Set(nodeNames(glb));
  const panel = s.parts.find((p) => p.id === 'PANEL');
  for (const id of ['+', '-', 'GND']) {
    const a = A.get(id);
    assert.ok(a && a.kind === 'pin', id);
    assert.ok(a.normal[2] > 0.999, `${id} faces +Z: ${a.normal}`);
    assert.ok(a.position[2] > panel.bounds.max[2], `${id} stands out of the front panel`);
  }
  // left to right seen from the front: - GND +
  assert.ok(A.get('-').position[0] < A.get('GND').position[0] && A.get('GND').position[0] < A.get('+').position[0], '- GND + from left to right');
  assert.deepEqual(A.get('+').aliases, ['V+', 'OUT+']);
  for (const [id, kind] of [['turn:VSET', 'rotate'], ['turn:ISET', 'rotate'], ['led:CV', 'emissive'], ['led:CC', 'emissive'], ['press:POWER', 'rotate']]) {
    const ch = s.channels.find((c) => c.id === id);
    assert.ok(ch && ch.kind === kind, id);
    assert.ok(nodes.has(id), `node ${id}`);
  }
  // the knobs turn about +-Z (out of the panel), as one piece each
  for (const id of ['turn:VSET', 'turn:ISET']) assert.ok(Math.abs(s.channels.find((c) => c.id === id).axis[2]) > 0.999, `${id} axis`);
  // each lamp node is the lamp alone, not the readouts lit with it
  for (const id of ['led:CV', 'led:CC']) {
    const ch = s.channels.find((c) => c.id === id), n = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
    const node = n.nodes.find((q) => q.name === id), mesh = n.meshes[node.mesh];
    const tris = mesh.primitives.filter((p) => p.mode === 4).reduce((t, p) => t + n.accessors[p.indices].count / 3, 0);
    assert.ok(tris > 0 && tris <= 24, `${id}: ${tris} triangles`);
    assert.ok(dist(node.translation, A.get(id).position) < 2 * MM, `${id} node at its lamp`);
    assert.equal(ch.color, { 'led:CV': '#4dff6a', 'led:CC': '#ff4b33' }[id]);
  }
  // the cover fades in see-through and lifts when exploded; the insides are the xray layer and stay put
  assert.deepEqual(s.layers.find((l) => l.id === 'cover'), { id: 'cover', nodes: ['static.cover'], opacity: [1, 0.28] });
  assert.ok(s.stats.trianglesXray > 0, 'the insides show in see-through');
  assert.ok(Math.abs(s.parts.find((p) => p.id === 'CASE').explode[1] - 70 * MM) < 0.5 * MM, 'the case lifts 70 mm');
  assert.deepEqual(s.parts.find((p) => p.id === 'INSIDE').explode, [0, 0, 0]);
});

test('Bunsen burner: the flame, collar and gas tap have their nodes; the barrel lifts when exploded', async () => {
  const { glb, sidecar: s } = await converted('lab/bunsen-burner');
  const nodes = new Set(nodeNames(glb));
  const flame = s.channels.find((c) => c.extras && c.extras.labId === 'flame:BURNER');
  assert.ok(flame, 'the flame channel');
  assert.equal(flame.id, 'led:FLAME');
  assert.equal(flame.kind, 'emissive');
  assert.ok(nodes.has(flame.id), 'the flame node');
  assert.deepEqual(flame.bind, { source: 'param', key: 'lit' });
  assert.equal(flame.extras.hiddenAtRest, true);
  // the flame stands on the barrel's top, 150 mm up
  const fp = s.parts.find((p) => p.id === 'FLAME');
  assert.deepEqual(fp.nodes, ['led:FLAME']);
  for (const id of ['turn:COLLAR', 'turn:TAP']) assert.ok(nodes.has(id), id);
  assert.ok(s.channels.find((c) => c.id === 'turn:COLLAR').axis[1] > 0.999, 'the collar turns about +Y');
  assert.ok(Math.abs(s.parts.find((p) => p.id === 'BARREL').explode[1] - 45 * MM) < 0.5 * MM, 'the barrel lifts 45 mm');
  assert.ok(s.layers.some((l) => l.id === 'xray'), 'see-through shows the gas jet');
  assert.ok(s.bounds.max[1] < 0.151 && s.bounds.max[1] > 0.149, 'at rest (unlit) the burner is 150 mm tall');
});

test('glassware: the liquid at its default volume and the clear glass are nodes of their own', async () => {
  for (const item of ['lab/beaker-250', 'lab/erlenmeyer-250']) {
    const { glb, sidecar: s } = await converted(item);
    const c = declared(item), nodes = new Set(nodeNames(glb));
    assert.ok(nodes.has('static.liquid'), `${item}: static.liquid`);
    assert.deepEqual(s.parts.find((p) => p.id === 'LIQUID').nodes, ['static.liquid']);
    assert.ok(s.layers.find((l) => l.id === 'base').nodes.includes('static.liquid'));
    assert.deepEqual(s.extras.liquid, c.extras.liquid);
    // the clear glass is a translucent node of its own, so the liquid shows through it (lab.js LAB.glass: 0.32)
    assert.ok(nodes.has('static.glass'), `${item}: static.glass`);
    assert.deepEqual(s.extras.nodeOpacity, { 'static.glass': [0.32, 0.176] });
    const n = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')).nodes.find((q) => q.name === 'static.glass');
    assert.equal(n.extras.opacity, 0.32);
    // the surface stands at the default volume's level
    const lv = c.extras.liquid.levelMm[String(c.defaults.volume)], top = s.parts.find((p) => p.id === 'LIQUID').bounds.max[1];
    assert.ok(Math.abs(top - lv * MM) < 1 * MM, `${item}: liquid top ${top} vs level ${lv} mm`);
  }
});

test('pendulum: the swing turns the string and bob about the pivot', async () => {
  const { sidecar: s } = await converted('lab/pendulum-stand');
  const ch = s.channels.find((c) => c.extras && c.extras.labId === 'swing:BOB');
  assert.ok(ch && ch.kind === 'rotate' && ch.id === 'turn:BOB');
  for (const id of ['STRING', 'BOB']) assert.ok(s.parts.find((p) => p.id === id).nodes.includes('turn:BOB'), id);
});
