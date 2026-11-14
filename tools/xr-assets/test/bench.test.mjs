// The bench adapter (docs/XR_ASSETS.md sections 2, 5): the Blink scene's items carry the simulation's ids where the
// simulation's component descriptors (src/parts/data/*.component.json) put them. The Uno's pins are the descriptor's
// pins at the descriptor's board-mm positions once mapped through the sidecar's frame.fromSource, with the board the
// right way round (D13 left of D12); the half breadboard's 400 holes are a1..j30 and the RAIL_* holes at the
// descriptor positions on a 2.54 mm pitch, grouped into strips and rails; the LED, resistor and jumper wire carry their
// leg ids, the LED its lens anchor and emissive channel; every glb validates and every sidecar is schema-clean.
// node --test test/bench.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { convert } from '../capture/assemble.mjs';
import { adapterFor } from '../capture/adapters.mjs';
import { ROOT, buildPage, loadPage } from '../capture/page.mjs';
import { allItems } from '../build.mjs';
import { validateGlb, sidecarErrors } from './validate.mjs';

const MM = 0.001;
const ITEMS = ['boards/uno-r3', 'parts/breadboard', 'parts/led', 'parts/resistor', 'parts/wire'];
const results = new Map();
const converted = (item) => { if (!results.has(item)) results.set(item, convert(item, adapterFor(item))); return results.get(item); };
const descriptor = (name) => JSON.parse(readFileSync(join(ROOT, 'src', 'parts', 'data', `${name}.component.json`), 'utf8'));
/** fromSource (column-major 4x4) applied to a board-mm point */
const apply = (m, [x, y, z]) => [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
const byId = (s) => new Map(s.anchors.map((a) => [a.id, a]));
/** horizontal distance in the asset (X, Z): anchors sit at a pin's tip or a hole's mouth, the descriptor gives x, y */
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

test('Uno R3: every descriptor pin is an anchor at the descriptor position, the right way round', async () => {
  const { sidecar: s } = await converted('boards/uno-r3');
  const A = byId(s), d = descriptor('uno-r3');
  assert.equal(s.source.descriptor, 'uno-r3');
  for (const p of d.pins) {
    const a = A.get(p.id);
    assert.ok(a, `descriptor pin ${p.id} has an anchor`);
    assert.equal(a.kind, 'pin', p.id);
    if (!p.position) continue;
    const want = apply(s.frame.fromSource, [p.position.x, p.position.y, 0]);
    assert.ok(flat(a.position, want) <= 0.3 * MM, `${p.id} at ${a.position} vs descriptor ${want}`);
  }
  // the Blink pins and the power and ICSP pins by name
  for (const id of ['D13', 'GND', '5V', '3V3', 'VIN', 'A0', 'A5', 'ICSP_1', 'ICSP_3', 'ICSP_6']) assert.ok(A.has(id) || [...A.values()].some((a) => (a.aliases || []).includes(id)), `${id} answers`);
  // the board is not mirrored: D13 lies left of D12 (smaller asset X), and the digital header runs D0 -> D13 leftwards
  assert.ok(A.get('D13').position[0] < A.get('D12').position[0], 'D13 is left of D12');
  const dx = Array.from({ length: 14 }, (_, i) => A.get(`D${i}`).position[0]);
  for (let i = 1; i < 14; i++) assert.ok(dx[i] < dx[i - 1], `D${i} is left of D${i - 1}`);
  // header pins point up, a socket's mouth has depth; aliases never name another anchor
  for (const id of ['D0', 'D13', 'A0', 'GND', 'ICSP_1']) {
    const a = A.get(id);
    assert.ok(a.normal[1] > 0.99, `${id} normal is +Y`);
    if (id !== 'ICSP_1') assert.ok(a.depth > 0, `${id} socket has depth`);
  }
  for (const a of s.anchors) for (const x of a.aliases || []) assert.ok(!A.has(x), `alias ${x} of ${a.id} is not an anchor id`);
  // headers list their pins in pin order along the header
  for (const h of ['header:IOL', 'header:IOH', 'header:POWER', 'header:AD', 'header:ICSP']) assert.ok(A.has(h), h);
  const iol = A.get('header:IOL'), d07 = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7'];
  assert.ok([d07, [...d07].reverse()].some((o) => JSON.stringify(o) === JSON.stringify(iol.members)), `header:IOL members in pin order: ${iol.members}`);
  for (const h of s.anchors.filter((a) => a.kind === 'header')) for (const m of h.members) assert.ok(A.has(m), `${h.id} member ${m}`);
  // the L LED (D13) is an emissive channel bound to its net, with its lens anchor
  const ch = s.channels.find((c) => c.id === 'led:L');
  assert.ok(ch && ch.kind === 'emissive', 'led:L channel');
  assert.deepEqual(ch.bind, { source: 'net', key: 'D13' });
  assert.ok(A.has('led:L') && A.get('led:L').channel === 'led:L', 'led:L anchor');
});

test('half breadboard: 400 holes at the descriptor positions, 2.54 mm pitch, strips and rails', async () => {
  const { sidecar: s } = await converted('parts/breadboard');
  const A = byId(s), d = descriptor('breadboard');
  const holes = s.anchors.filter((a) => a.kind === 'hole');
  assert.equal(holes.length, 400);
  assert.equal(d.pins.length, 400);
  for (const p of d.pins) {
    const a = A.get(p.id);
    assert.ok(a && a.kind === 'hole', `descriptor hole ${p.id}`);
    const want = apply(s.frame.fromSource, [p.position.x, p.position.y, 0]);
    assert.ok(flat(a.position, want) <= 0.3 * MM, `${p.id} at ${a.position} vs ${want}`);
    assert.ok(a.normal[1] > 0.99 && a.depth > 0, `${p.id} opens upward with depth`);
  }
  // pitch: along a row and down a column
  const dist = (x, y) => Math.hypot(...[0, 1, 2].map((k) => A.get(x).position[k] - A.get(y).position[k])) / MM;
  for (const [x, y] of [['a1', 'a2'], ['a29', 'a30'], ['a1', 'b1'], ['f10', 'g10'], ['RAIL_TP2', 'RAIL_TP3']]) assert.ok(Math.abs(dist(x, y) - 2.54) < 0.01, `${x}-${y} is 2.54 mm`);
  // every hole mouth on one plane (the breadboard's top)
  const y0 = holes[0].position[1];
  assert.ok(holes.every((h) => Math.abs(h.position[1] - y0) < 1e-6), 'hole mouths are coplanar');
  // strips: five holes a..e or f..j of one column
  assert.deepEqual(A.get('strip:S12u').members, ['a12', 'b12', 'c12', 'd12', 'e12']);
  assert.deepEqual(A.get('strip:S12l').members, ['f12', 'g12', 'h12', 'i12', 'j12']);
  assert.equal(s.anchors.filter((a) => a.kind === 'strip').length, 60);
  // rails: the descriptor's rail holes, in column order, each on one line, the T+ rail the farthest back but one
  for (const r of ['RAIL_TP', 'RAIL_TN', 'RAIL_BP', 'RAIL_BN']) {
    const rail = A.get(`rail:${r}`);
    const want = d.pins.filter((p) => p.id.startsWith(r)).map((p) => p.id);
    assert.deepEqual(rail.members, want, `rail:${r} members`);
    const z = rail.members.map((m) => A.get(m).position[2]);
    assert.ok(z.every((v) => Math.abs(v - z[0]) < 1e-6), `${r} holes are in line`);
  }
  assert.ok(A.get('RAIL_TP2').aliases.includes('T+2'), 'rail holes answer to the figure ref');
  const zOf = (id) => A.get(id).position[2];
  assert.ok(zOf('RAIL_TN2') < zOf('RAIL_TP2') && zOf('RAIL_TP2') < zOf('a1') && zOf('a1') < zOf('j1') && zOf('j1') < zOf('RAIL_BN2') && zOf('RAIL_BN2') < zOf('RAIL_BP2'),
    'back to front: T-, T+, a..j, B-, B+');
});

test('LED, resistor, wire: leg ids from the descriptors, the LED lens and its emissive channel', async () => {
  const led = (await converted('parts/led')).sidecar, L = byId(led);
  assert.equal(led.source.descriptor, 'led-5mm');
  for (const id of ['A', 'K']) assert.ok(L.get(id) && L.get(id).kind === 'pin', `LED leg ${id}`);
  const lens = L.get('led:LED1');
  assert.ok(lens && lens.kind === 'led' && lens.normal[1] > 0.99, 'LED lens anchor points up');
  assert.ok(lens.position[1] > L.get('A').position[1] + 5 * MM, 'the lens sits above the legs');
  const ch = led.channels.find((c) => c.id === 'led:LED1');
  assert.ok(ch && ch.kind === 'emissive' && ch.nodes.includes('led:LED1'), 'led:LED1 channel');
  assert.equal(ch.color, '#e8392e');
  assert.equal(lens.channel, 'led:LED1');

  const res = (await converted('parts/resistor')).sidecar, R = byId(res);
  assert.equal(res.source.descriptor, 'resistor');
  for (const id of descriptor('resistor').pins.map((p) => p.id)) assert.ok(R.get(id) && R.get(id).kind === 'pin', `resistor leg ${id}`);
  const span = Math.hypot(...[0, 1, 2].map((k) => R.get('P1').position[k] - R.get('P2').position[k])) / MM;
  assert.ok(Math.abs(span / 2.54 - Math.round(span / 2.54)) < 0.01, `resistor legs on the 2.54 mm grid (${span} mm)`);

  const wire = (await converted('parts/wire')).sidecar, Wr = byId(wire);
  for (const id of ['1', '2']) assert.ok(Wr.get(id) && Wr.get(id).kind === 'pin', `wire end ${id}`);
  assert.ok(wire.parts.some((p) => p.role === 'wire'), 'the wire is a wire part');
});

test('every part page stands on the breadboard top: its leads meet the holes at y = 0', async () => {
  const pages = allItems().filter((i) => i.startsWith('parts/') && i !== 'parts/breadboard');
  let legs = 0;
  for (const item of pages) {
    const { sidecar: s } = await converted(item);
    for (const a of s.anchors.filter((x) => x.kind === 'pin' && x.extras && x.extras.hole)) {
      legs++;
      assert.ok(Math.abs(a.position[1]) <= 1 * MM, `${item} ${a.id} (hole ${a.extras.hole}) at y = ${(a.position[1] / MM).toFixed(2)} mm`);
      assert.ok(a.normal[1] < -0.99, `${item} ${a.id} points down into its hole`);
    }
  }
  assert.ok(legs > 60, `${legs} leads in holes`);
});

test('knobs, servos, steppers, RGB and module LEDs have channels; anchors name only channels that exist', async () => {
  const ch = async (item, id) => { const { sidecar: s } = await converted(item); const c = s.channels.find((x) => x.id === id); assert.ok(c, `${item} ${id}`); return c; };
  const deg = Math.PI / 180, vertical = (c) => Math.abs(Math.abs(c.axis[1]) - 1) < 1e-6;
  // the servo turns its horn by the commanded angle about the vertical shaft (the fit of the drawing, not a guess)
  const sv = await ch('parts/servo-sg90', 'servo:SV1');
  assert.ok(vertical(sv) && Math.abs(Math.abs(sv.scale) - deg) < 1e-4, `servo turns 1 degree per degree (${sv.scale})`);
  const pot = await ch('parts/potentiometer', 'turn:P1');
  assert.ok(vertical(pot) && Math.abs(Math.abs(pot.scale) - deg) < 1e-6, 'pot knob turns about its shaft');
  assert.equal((await ch('parts/rgb-led', 'led:P1')).value.unit, 'rgb');
  assert.equal((await ch('parts/stepper-28byj48', 'motor:ST1')).kind, 'spin');
  assert.ok((await converted('parts/stepper-28byj48')).sidecar.anchors.some((a) => a.id === 'motor:ST1'), 'stepper motor anchor');
  for (const id of ['led:LED_R', 'led:LED_Y', 'led:LED_G']) assert.equal((await ch('modules/traffic-light', id)).kind, 'emissive');
  for (const id of ['led:LED_A', 'led:LED_D']) assert.equal((await ch('modules/uln2003', id)).kind, 'emissive');
  for (const [item, r] of results) {
    const { sidecar: s } = await r, ids = new Set(s.channels.map((c) => c.id));
    for (const a of s.anchors) if (a.channel) assert.ok(ids.has(a.channel), `${item} ${a.id} names channel ${a.channel}`);
  }
});

test('robotics/l298n: mat items carry prefixed anchors and every wire end lands on its pin', async () => {
  const item = 'robotics/l298n';
  const { glb, sidecar: s } = await converted(item);
  const A = byId(s);
  for (const id of ['NANO/D8', 'NANO/GND', 'header:NANO/J1', 'led:NANO/L', 'MOTA/PLUS', 'MOTB/MINUS', 'IN1', 'ENA']) assert.ok(A.has(id), `anchor ${id}`);
  assert.ok(!s.anchors.some((a) => a.id.startsWith('BB/')), 'no breadboard on this bench');
  // the wire ends the engine draws (matEnd), from a page in the same rest state, mapped like the anchors
  const page = await loadPage(buildPage(item).html, item, 'power=0');
  try {
    const ad = adapterFor(item);
    await ad.setup(page, { warn: () => {} });
    page.eval('SL.bench.__xr.wires = []');
    page.scene();
    const ends = JSON.parse(page.eval('JSON.stringify(SL.bench.__xr.wires)'));
    const defs = ad.info.wires.filter((w) => w.on && w.mat);
    assert.equal(ends.length, defs.length, 'one drawn wire per wire set out');
    assert.ok(defs.length >= 11, `${defs.length} wires`);
    const toAsset = (w) => apply(s.frame.fromSource, ad.toBoard(w));
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    // the anchor a ref names: a mat item's pin or leg under its prefix, a base pin by the figure's id
    const named = (ref) => {
      const m = /^([A-Za-z_][\w-]*)\.(.+)$/.exec(ref);
      if (m && ad.info.mat.some((it) => it.id === m[1])) {
        const want = `${m[1]}/${m[2]}`, x = (a) => a.extras || {};
        // by id, alias, figure pin, net (a net with several pins: the engine takes one of them) or a mat part's leg
        return s.anchors.filter((a) => a.kind === 'pin' && a.id.startsWith(`${m[1]}/`)
          && (a.id === want || (a.aliases || []).includes(want) || x(a).figurePin === want || x(a).net === want || x(a).leg === m[2]));
      }
      return s.anchors.filter((a) => a.kind === 'pin' && (a.id === ref || (a.extras && a.extras.figurePin === ref)));
    };
    defs.forEach((w, i) => {
      for (const [ref, end] of [[w.from, ends[i].a], [w.to, ends[i].b]]) {
        const p = toAsset(end), cands = named(ref);
        assert.ok(cands.length, `${ref} names an anchor`);
        const ok = cands.some((a) => {
          const d = sub(p, a.position), ax = dot(d, a.normal), lat = Math.hypot(...sub(d, a.normal.map((v) => v * ax)));
          // on the pin's axis, from its tip down to the 2 mm the engine seats a jumper below a top-side part's top
          // (bench.js matEnd; on a flat pad that is inside the board, a figure quirk)
          return lat <= 0.3 * MM && ax <= 0.3 * MM && ax >= -(Math.max(a.depth || 0, 2 * MM) + 0.3 * MM);
        });
        assert.ok(ok, `wire ${w.from}-${w.to}: the end at ${ref} (${p.map((v) => (v / MM).toFixed(2))} mm) is on ${cands.map((a) => `${a.id} (${a.position.map((v) => (v / MM).toFixed(2))})`).join(', ')}`);
      }
    });
  } finally { page.close(); }
  const v = await validateGlb(glb);
  assert.equal(v.errors, 0);
  assert.deepEqual(sidecarErrors(s), []);
});

for (const item of ITEMS) {
  test(`${item}: glb validates, sidecar is schema-clean`, async () => {
    const { glb, sidecar } = await converted(item);
    const v = await validateGlb(glb);
    assert.equal(v.errors, 0, JSON.stringify(v.issues).slice(0, 2000));
    assert.deepEqual(sidecarErrors(sidecar), []);
    const ids = sidecar.anchors.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length, 'anchor ids are unique');
  });
}
