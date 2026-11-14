// The ink look and loadXrAsset, without a GPU: the band maths against Colorfigures core.js itself, the colour and
// silhouette maths, the channel maths, and the helper applied to a hand-built glb (viewer/fixture.js) in Node.
// node --test test/material.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  bandOf, bandColor, mixHex, matOf, SOFT, SHADES, smoothstep, blendBands, hexToRgb, srgbToLinear, linearToSrgb,
  hullWeight, hull2d, shadowOffset, projectShadow, createInkMaterial, createLineMaterial, createOutline, createShadow,
  createFatLines, createInkUniforms, updateInkLights, shadeOf, createGlow, setGlow, HULL_MAX, HULL_MIN,
} from '../material/ink.js';
import { loadXrAsset, clampValue, rotateAngle, spinRate, translateOffset, emissiveOf, nodePose, partWeights, GLOW_K, GLOW_R0, glowRadius } from '../material/xr-asset.js';
import { buildFixture } from '../viewer/fixture.js';

const CORE = readFileSync(fileURLToPath(new URL('../../../figures/vendor/colorfigures/core.js', import.meta.url)), 'utf8');

/** core.js's own SOFT, step3, mix and matOf, evaluated from its source */
function coreShading() {
  const grab = (re) => { const m = CORE.match(re); assert.ok(m, 'core.js has ' + re); return m[0]; };
  const src = [
    grab(/const SOFT = [^;]+;/),
    grab(/const step3 = [\s\S]*?: m\.m; };/),
    grab(/const mix = [^\n]+/),
    grab(/const matOf = [^\n]+/),
  ].join('\n');
  // step3 calls CF_MAT only for a non-object material; the tests always pass objects
  return new Function('CF_MAT', src + '\nreturn { SOFT, step3, mix, matOf };')(() => { throw new Error('not a material'); });
}
const core = coreShading();
const MATS = [core.matOf('#f4b829'), core.matOf('#2f8f83'), { l: '#eef0f0', m: '#c6ccce', d: '#8f989b' }, { l: '#55504a', m: '#3d3935', d: '#272421' }, core.matOf('#76a0e2')];
const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);

test('the soft step and the thresholds are the core\'s', () => {
  assert.equal(SOFT, core.SOFT);
  const tone = CORE.match(/const tone\s*=.*step3\(dot\(rotV\(n\),L\),\s*([-.\d]+),\s*([-.\d]+)/), toneI = CORE.match(/const toneI\s*=.*step3\(dot\(rotV\(n\),LIN\),\s*([-.\d]+),\s*([-.\d]+)/);
  assert.deepEqual([SHADES.sun.hi, SHADES.sun.lo], [Number(tone[1]), Number(tone[2])]);
  assert.deepEqual([SHADES.fixed.hi, SHADES.fixed.lo], [Number(toneI[1]), Number(toneI[2])]);
});

test('bandOf gives the colour core.js step3 gives, at every dot, for sun and fixed', () => {
  for (const { hi, lo } of [SHADES.sun, SHADES.fixed]) {
    for (const d of range(-1, 1, 800)) {
      const w = bandOf(d, hi, lo);
      assert.ok(Math.abs(w[0] + w[1] + w[2] - 1) < 1e-12 && w.every((x) => x >= 0 && x <= 1), `weights at ${d}`);
      for (const m of MATS) assert.equal(bandColor(d, hi, lo, m), core.step3(d, hi, lo, m), `d=${d} hi=${hi} ${m.l}`);
    }
  }
});

test('the shader\'s branch-free band weights equal bandOf (the sun\'s soft zones overlap: a > 0 wins)', () => {
  const glsl = (d, hi, lo) => {
    const a = smoothstep(hi - SOFT, hi + SOFT, d), b = smoothstep(lo - SOFT, lo + SOFT, d), useA = a > 0 ? 1 : 0;
    return [a, b * (1 - useA) + (1 - a) * useA, (1 - b) * (1 - useA)];
  };
  for (const { hi, lo } of [SHADES.sun, SHADES.fixed]) for (const d of range(-1, 1, 400)) {
    const x = bandOf(d, hi, lo), y = glsl(d, hi, lo);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(x[i] - y[i]) < 1e-12, `d=${d}`);
  }
  // in the overlap (-0.33, -0.27) the light weight is used and the dark one ignored, exactly as step3
  assert.deepEqual(bandOf(-0.3, -0.15, -0.45).map((v) => +v.toFixed(6)), [+smoothstep(-0.33, 0.03, -0.3).toFixed(6), +(1 - smoothstep(-0.33, 0.03, -0.3)).toFixed(6), 0]);
  assert.deepEqual(bandOf(1, -0.15, -0.45), [1, 0, 0]);
  assert.deepEqual(bandOf(-1, -0.15, -0.45), [0, 0, 1]);
  assert.deepEqual(bandOf(0.3, 0.6, 0.05), [0, 1, 0]);
});

test('matOf and mix are the core\'s; the shader\'s sRGB blend matches the figure\'s hex mix', () => {
  for (const hex of ['#f4b829', '#ef6a4c', '#93d3b0', '#76a0e2', '#f3a6bb', '#000000', '#ffffff', '#2f8f83']) {
    assert.deepEqual(matOf(hex), core.matOf(hex));
    for (const t of [0, 0.16, 0.42, 0.5, 0.77, 1]) assert.equal(mixHex(hex, '#41538f', t), core.mix(hex, '#41538f', t));
  }
  // the vertex shader gets linear band colours, goes back to sRGB, blends by the weights and returns to linear
  for (const m of MATS) for (const d of range(-1, 1, 100)) {
    const w = bandOf(d, SHADES.sun.hi, SHADES.sun.lo);
    const viaLinear = [m.l, m.m, m.d].map((h) => hexToRgb(h).map(srgbToLinear).map(linearToSrgb));
    const got = blendBands(w, ...viaLinear).map((c) => linearToSrgb(srgbToLinear(c)) * 255);
    const want = hexToRgb(core.step3(d, SHADES.sun.hi, SHADES.sun.lo, m)).map((c) => c * 255);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(got[i] - want[i]) <= 0.51, `d=${d} ${m.l} ch${i}: ${got[i]} vs ${want[i]}`);
  }
});

test('silhouette weight follows hullInk: thin parts stay light, big bodies cap at 2.8', () => {
  const sq = (s) => hull2d([[0, 0], [s, 0], [s, s], [0, s], [s / 2, s / 2]]);
  assert.equal(hull2d([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]).length, 4);
  assert.equal(hullWeight(sq(80), 100), HULL_MAX);                  // a body filling the frame
  assert.ok(Math.abs(hullWeight(sq(1), 100) - (HULL_MIN + 20 * (1 / 2) / 100)) < 1e-9);   // 2A/P = s/2 for a square
  assert.ok(hullWeight([[0, 0], [40, 0], [40, 0.5], [0, 0.5]], 100) < 1.2);   // a long thin rod
  const w = partWeights(buildFixture().sidecar);
  assert.equal(w.get(1), HULL_MAX);                                  // the board
  assert.ok(w.get(4) < 1.3, 'the tiny LED gets a light rim');
  assert.ok(w.get(6) > w.get(4), 'the servo is heavier than the LED');
});

test('the cast shadow moves each point away from the sun by shadowLength x height', () => {
  const sun = [-0.324, 0.762, -0.561];
  const [ox, oz] = shadowOffset(sun, 0.45);
  assert.ok(Math.abs(Math.hypot(ox, oz) - 0.45) < 1e-12);
  assert.ok(ox * sun[0] + oz * sun[2] < 0, 'away from the sun');
  const p = projectShadow([0.01, 0.02, -0.03], sun, 0.45, 0);
  assert.equal(p[1], 0);
  assert.ok(Math.abs(Math.hypot(p[0] - 0.01, p[2] + 0.03) - 0.02 * 0.45) < 1e-12);
  assert.deepEqual(projectShadow([0.01, -0.001, 0], sun), [0.01, 0, 0]);   // below the plane: no length
  assert.deepEqual(shadowOffset([0, 1, 0]), [0, 0]);
});

test('channel maths: rotate, spin, translate, emissive, and a node turned about its pivot with explode', () => {
  const rot = { kind: 'rotate', value: { unit: 'deg', min: 0, max: 180, rest: 90 }, axis: [0, 1, 0], pivot: [0.01, 0, 0], scale: Math.PI / 180 };
  assert.ok(Math.abs(rotateAngle(rot, 180) - Math.PI / 2) < 1e-12);
  assert.ok(Math.abs(rotateAngle(rot, 400) - Math.PI / 2) < 1e-12, 'clamped to max');
  assert.equal(rotateAngle(rot, 90), 0);
  const spin = { kind: 'spin', value: { unit: 'rpm', min: 0, max: 12000, rest: 0 }, scale: -1 };
  assert.ok(Math.abs(spinRate(spin, 60) + 2 * Math.PI) < 1e-12, '60 rpm CW about +Y is -2pi rad/s');
  const tr = { kind: 'translate', value: { unit: 'press', min: 0, max: 1, rest: 0 }, axis: [0, -1, 0], scale: 0.0006 };
  assert.deepEqual(translateOffset(tr, 1).toArray().map((v) => +v.toFixed(9)), [0, -0.0006, 0]);
  assert.equal(clampValue(tr, -3), 0);
  const led = { kind: 'emissive', value: { unit: 'level', min: 0, max: 1, rest: 0 }, color: '#ffb52e' };
  assert.deepEqual(emissiveOf(led, 0.5), { color: '#ffb52e', level: 0.5 });
  assert.deepEqual(emissiveOf(led, 7), { color: '#ffb52e', level: 1 });
  const rgb = { kind: 'emissive', value: { unit: 'rgb', min: 0, max: 1, rest: 0 } };
  assert.deepEqual(emissiveOf(rgb, [0.5, 0.25, 0]), { color: '#ff8000', level: 0.5 });
  assert.deepEqual(emissiveOf(rgb, [0, 0, 0]), { color: '#000000', level: 0 });
  // a node at rest at (0.02, 0, 0), turned 90 degrees about +Y through (0.01, 0, 0), exploded 0.5 x (0, 0.01, 0)
  const rest = { position: new THREE.Vector3(0.02, 0, 0), quaternion: new THREE.Quaternion() };
  const pose = nodePose(rest, new THREE.Vector3(0, 0.01, 0), 0.5, [{ axis: new THREE.Vector3(0, 1, 0), pivot: new THREE.Vector3(0.01, 0, 0), angle: Math.PI / 2 }]);
  assert.deepEqual(pose.position.toArray().map((v) => +v.toFixed(9)), [0.01, 0.005, -0.01]);
  assert.ok(Math.abs(pose.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2))) < 1e-9);
});

test('materials: bands double-sided, flat decals pulled forward, outline shares geometry, shadow offset', () => {
  const g = new THREE.BoxGeometry(0.01, 0.01, 0.01);
  const look = { sun: [0, 1, 0], fixedLight: [0, 0, 1], shadowLength: 0.45 };
  const u = createInkUniforms(look);
  const sun = createInkMaterial({ shade: 'sun', look, geometry: g, uniforms: u });
  assert.equal(sun.side, THREE.DoubleSide);
  assert.equal(sun.uniforms.uLight, u.uSun);
  assert.deepEqual([sun.uniforms.uHi.value, sun.uniforms.uLo.value], [-0.15, -0.45]);
  const fixed = createInkMaterial({ shade: 'fixed', look, uniforms: u });
  assert.equal(fixed.uniforms.uLight, u.uFixed);
  const flat = createInkMaterial({ shade: 'flat', uniforms: u });
  assert.ok(flat.polygonOffset && flat.polygonOffsetFactor < 0 && 'SHADE_FLAT' in flat.defines);
  assert.equal(sun.uniforms.uExplode, flat.uniforms.uExplode, 'explode is one shared uniform');
  const mesh = new THREE.Mesh(g, sun);
  const out = createOutline(mesh, { uniforms: u });
  assert.equal(out.geometry, g);
  assert.equal(out.parent, mesh);
  assert.equal(out.material.side, THREE.DoubleSide);
  assert.ok(out.renderOrder > mesh.renderOrder);
  const root = new THREE.Group(); root.add(mesh);
  const sh = createShadow(mesh, { look, root, uniforms: u });
  assert.equal(sh.parent, root);
  assert.ok(sh.material.polygonOffset && sh.material.polygonOffsetFactor < 0);
  assert.equal(sh.material.uniforms.uShadowDir.value.length(), 0, 'a sun straight above casts no length');
  const line = createLineMaterial({ uniforms: u });
  assert.equal(line.userData.inkRole, 'line');
  assert.equal(shadeOf({ name: 'ink.fixed', userData: {} }), 'fixed');
  assert.equal(shadeOf({ name: 'x', userData: { iynkInk: { shade: 'flat' } } }), 'flat');
  // the lights are the item's: turning the root turns the uniform
  root.rotation.y = Math.PI / 2; root.updateMatrixWorld(true);
  updateInkLights(u, { sun: [1, 0, 0], fixedLight: [0, 1, 0] }, root);
  assert.deepEqual(u.uSun.value.toArray().map((v) => +v.toFixed(9) + 0), [0, 0, -1]);
});

test('fat lines: one instance per segment with the figure\'s width and colour', () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1], 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('_line_width', new THREE.Float32BufferAttribute([0.5, 0.5, 2.8, 2.8], 1));
  const fat = createFatLines(new THREE.LineSegments(g));
  assert.equal(fat.geometry.instanceCount, 2);
  assert.deepEqual(Array.from(fat.geometry.attributes.iWidth.array).map((v) => +v.toFixed(3)), [0.5, 2.8]);
  assert.deepEqual(Array.from(fat.geometry.attributes.iEnd.array.slice(3)), [0, 1, 1]);
});

const fixtureAsset = async (opts = {}) => {
  const { sidecar, glb } = buildFixture();
  return loadXrAsset('mem://fixture/fixtures/ink-board.json', { sidecar, glb, ...opts });
};

test('loadXrAsset applies the ink look to a hand-built glb in Node', async () => {
  const a = await fixtureAsset();
  assert.ok(a.object.isGroup);
  assert.equal(a.root.userData.name, 'fixtures/ink-board');
  for (const n of ['static', 'static.cover', 'static.xray', 'led:L', 'press:RESET', 'servo:SRV1', 'prop:M1']) assert.ok(a.node(n), n);
  const roles = {};
  a.object.traverse((o) => {
    if (!(o.isMesh || o.isLine)) return;
    assert.ok(o.material.isShaderMaterial, `${o.name} has an ink material`);
    const r = o.material.userData.inkRole; roles[r] = (roles[r] || 0) + 1;
  });
  assert.deepEqual(roles, { body: 10, line: 14, outline: 6, shadow: 4, glow: 1 },
    'GL lines (hidden) + fat lines; one hull per node with solids; shadows: static, cover, servo, prop; a halo for led:L (drawn only while lit)');
  // at rest: xray hidden; bodies + fat lines of base and cover, plus 6 hulls and 4 shadows
  assert.equal(a.drawCalls(), 25);
  assert.equal(a.drawCalls() - 10, a.sidecar.stats.drawCalls);
  a.seeThrough(1);
  assert.equal(a.node('static.xray').visible, true);
  const cover = a.node('static.cover').children.find((o) => o.isMesh);
  assert.ok(Math.abs(cover.material.uniforms.uOpacity.value - 0.28) < 1e-9 && cover.material.transparent);
  assert.equal(cover.children.find((o) => o.userData.inkRole === 'outline').visible, false, 'no hull through a faded cover');
  a.seeThrough(0);
  assert.equal(a.node('static.xray').visible, false);
  a.dispose();
  // the cheaper settings: hulls on static nodes only, GL lines, no channel shadows
  const b = await fixtureAsset({ outlines: 'static', lines: 'gl', channelShadows: 'none' });
  assert.equal(b.drawCalls(), 15 + 2 + 2);
  b.dispose();
});

test('channels drive nodes and materials; spin advances in update(dt)', async () => {
  const a = await fixtureAsset();
  const led = a.node('led:L').children.find((o) => o.isMesh);
  assert.equal(led.material.uniforms.uEmissiveLevel.value, 0);
  assert.equal(a.set('led:L', 1), true);
  assert.equal(led.material.uniforms.uEmissiveLevel.value, 1);
  const lit = led.material.uniforms.uEmissive.value, want = new THREE.Color().setRGB(...hexToRgb('#ffb52e').map(srgbToLinear));
  assert.ok(Math.abs(lit.r - want.r) + Math.abs(lit.g - want.g) + Math.abs(lit.b - want.b) < 1e-6);
  const staticBody = a.node('static').children.find((o) => o.isMesh);
  assert.equal(staticBody.material.uniforms.uEmissiveLevel.value, 0, 'lighting the LED lights nothing else');
  const btn = a.node('press:RESET'), y0 = btn.position.y;
  a.set('press:RESET', 1);
  assert.ok(Math.abs(btn.position.y - (y0 - 0.0006)) < 1e-12);
  a.set('press:RESET', 0);
  const srv = a.node('servo:SRV1');
  a.set('servo:SRV1', 180);
  assert.ok(Math.abs(srv.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2))) < 1e-9);
  const prop = a.node('prop:M1');
  a.set('prop:M1', 60);
  a.update(0.125);                                  // 60 rpm for 1/8 s: an eighth of a turn, CW about +Y
  assert.ok(Math.abs(prop.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 4))) < 1e-9);
  assert.equal(a.set('nope:X', 1), false);
  a.dispose();
});

test('anchor() honours explode, its channel\'s motion and the item\'s world transform', async () => {
  const a = await fixtureAsset();
  const rest = a.sidecar.anchors.find((x) => x.id === 'D3').position;
  const d3 = a.anchor('D3');
  assert.deepEqual(d3.position.toArray().map((v) => +v.toFixed(9)), rest.map((v) => +v.toFixed(9)));
  assert.equal(d3.kind, 'pin'); assert.deepEqual(d3.aliases, ['J1.4']);
  a.explode(0.5);                                   // J1 is 'tall': 14 mm at explode 1
  assert.ok(Math.abs(a.anchor('D3').position.y - (rest[1] + 0.007)) < 1e-12);
  a.explode(0);
  a.set('press:RESET', 1);
  const btn = a.sidecar.anchors.find((x) => x.id === 'control:RESET').position;
  assert.ok(Math.abs(a.anchor('control:RESET').position.y - (btn[1] - 0.0006)) < 1e-12, 'follows the press');
  a.set('servo:SRV1', 180);                         // the horn tip turns a quarter about +Y through the pivot
  const horn = a.anchor('SRV1/HORN').position.toArray().map((v) => +v.toFixed(9));
  assert.deepEqual(horn, [0.013, 0.0228, -0.023]);
  // move and turn the whole item: anchors come back in world space, normals turned
  a.object.position.set(1, 2, 3);
  a.object.rotation.set(0, 0, Math.PI / 2);         // +Y turns to -X
  a.object.updateMatrixWorld(true);
  const w = a.anchor('D3');
  assert.deepEqual(w.normal.toArray().map((v) => +v.toFixed(9) + 0), [-1, 0, 0]);
  const expect = new THREE.Vector3(...rest).applyMatrix4(a.object.matrixWorld);
  assert.ok(w.position.distanceTo(expect) < 1e-12);
  // and the lights turn with it
  a.update(0);
  const sun = new THREE.Vector3(...a.sidecar.look.sun).applyAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  assert.ok(a.uniforms.uSun.value.distanceTo(sun) < 1e-9);
  assert.equal(a.anchor('nope'), null);
  a.dispose();
});

test('highlight and part visibility use the shared uniforms (bitmask of 512 parts) and hide channel nodes', async () => {
  const a = await fixtureAsset();
  a.highlight('U1');
  assert.equal(a.uniforms.uHighlight.value, 2);
  a.highlight(null);
  assert.equal(a.uniforms.uHighlight.value, -1);
  a.setPartVisible('SRV1', false);
  assert.equal(a.uniforms.uHidden.value[0], 1 << 6);
  assert.equal(a.node('servo:SRV1').visible, false);
  a.setPartVisible('PCB', false);                    // hides the board and every part under it
  assert.equal(a.uniforms.uHidden.value[0] & 0b111111110, 0b111111110);
  assert.equal(a.node('led:L').visible, false);
  a.setPartVisible('PCB', true);
  assert.equal(a.uniforms.uHidden.value[0], 0);
  assert.equal(a.node('servo:SRV1').visible, true);
  a.dispose();
});

/** the names of the nodes (direct children of the root) whose geometry casts a shadow */
const castingNodes = (a) => {
  const out = new Set();
  a.root.traverse((o) => {
    if (o.userData.inkRole !== 'shadow') return;
    let n = o.userData.source;
    while (n.parent && n.parent !== a.root) n = n.parent;
    out.add(n.userData.name);
  });
  return [...out].sort();
};

test('a channel node casts a shadow when it turns, or when it is at least a quarter of the item\'s size', async () => {
  const a = await fixtureAsset();
  assert.deepEqual(castingNodes(a), ['prop:M1', 'servo:SRV1', 'static', 'static.cover'], 'turning nodes cast; the small LED and button do not');
  a.dispose();
  // the servo (15 mm, 0.2 of the item's 78 mm) and the prop (26 mm, 0.34) made emissive, so neither turns
  const { sidecar, glb } = buildFixture();
  for (const c of sidecar.channels) {
    if (c.id === 'servo:SRV1' || c.id === 'prop:M1') Object.assign(c, { kind: 'emissive', value: { unit: 'level', min: 0, max: 1, rest: 0 }, color: '#ffffff' });
  }
  const b = await loadXrAsset('mem://fixture/fixtures/ink-board.json', { sidecar, glb });
  assert.deepEqual(castingNodes(b), ['prop:M1', 'static', 'static.cover'], 'the big still node casts, the small one does not');
  b.dispose();
  const c = await fixtureAsset({ channelShadows: 'none' });
  assert.deepEqual(castingNodes(c), ['static', 'static.cover']);
  c.dispose();
});

test('a lit LED draws one halo: hidden at level 0, one draw call more when lit, in the channel\'s colour', async () => {
  const a = await fixtureAsset();
  const glow = a.node('led:L').children.find((o) => o.userData.inkRole === 'glow');
  assert.ok(glow, 'a halo on the LED node');
  assert.equal(glow.material.blending, THREE.CustomBlending);
  assert.equal(glow.material.depthWrite, false);
  assert.equal(glow.renderOrder, 3);
  assert.equal(glow.visible, false, 'off: nothing drawn');
  const off = a.drawCalls();
  a.set('led:L', 1);
  assert.equal(glow.visible, true);
  assert.equal(a.drawCalls(), off + 1, 'one draw call per lit LED');
  const want = new THREE.Color().setRGB(...hexToRgb('#ffb52e').map(srgbToLinear)), c = glow.material.uniforms.uColor.value;
  assert.ok(Math.abs(c.r - want.r) + Math.abs(c.g - want.g) + Math.abs(c.b - want.b) < 1e-6, 'the channel colour');
  assert.equal(glow.material.uniforms.uLevel.value, 1);
  a.set('led:L', 0.4);
  assert.equal(glow.material.uniforms.uLevel.value, 0.4, 'intensity follows the level');
  a.set('led:L', 0);
  assert.equal(glow.visible, false);
  assert.equal(a.drawCalls(), off);
  // at the channel's anchor (5.4 mm up; the node stands on the board's top at 4.6 mm), sized from the node's bounds
  assert.deepEqual(glow.material.uniforms.uCenter.value.toArray().map((v) => +v.toFixed(9) + 0), [0, 0.0008, 0]);
  assert.ok(Math.abs(glow.material.uniforms.uRadius.value - glowRadius(Math.hypot(1.6e-3, 0.8e-3, 0.8e-3))) < 1e-9);
  assert.ok(Math.abs(glowRadius(0.01) - (GLOW_K * 0.01 + GLOW_R0)) < 1e-12);
  // it goes with its part
  a.set('led:L', 1);
  a.setPartVisible('L', false);
  assert.equal(a.drawCalls(), off - 3, 'the LED node (body, fat line, hull) and its halo');
  a.dispose();
  // glow: false draws none
  const b = await fixtureAsset({ glow: false });
  b.set('led:L', 1);
  let n = 0;
  b.object.traverse((o) => { if (o.userData.inkRole === 'glow') n++; });
  assert.equal(n, 0);
  assert.equal(b.drawCalls(), off);
  b.dispose();
  // setGlow on its own: colour and visibility
  const g = createGlow({ color: '#ff0000', level: 0 });
  assert.equal(g.visible, false);
  setGlow(g, '#00ff00', 0.5);
  assert.equal(g.visible, true);
  assert.deepEqual(g.material.uniforms.uColor.value.toArray(), [0, 1, 0]);
  assert.equal(g.material.uniforms.uLevel.value, 0.5);
});
