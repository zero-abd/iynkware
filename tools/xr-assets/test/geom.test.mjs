// The geometry builders, the rigid fit, the glb writer and the schema's two copies (TS type and JSON schema).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newell, triangulate, fromPrim, fromPath, sub, add, dot, cross, len, avg, scale, norm } from '../gltf/geom.mjs';
import { MeshBatch, writeGlb, linear } from '../gltf/glb.mjs';
import { fitRigid, axisAngle, rotate } from '../capture/fit.mjs';
import { validateGlb } from './validate.mjs';

const TOOL = join(import.meta.dirname, '..');
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const nearV = (a, b, eps = 1e-9) => a.forEach((x, i) => near(x, b[i], eps));
const area3 = (v, tris) => tris.reduce((s, [a, b, c]) => s + len(cross(sub(v[b], v[a]), sub(v[c], v[a]))) / 2, 0);
const shades = new Map();

test('newell gives the right-hand normal and zero for a degenerate polygon', () => {
  nearV(newell([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]), [0, 0, 1]);
  nearV(newell([[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]), [0, 0, -1]);
  nearV(newell([[0, 0, 0], [1, 1, 1], [2, 2, 2]]), [0, 0, 0]);
});

test('triangulate covers a concave polygon exactly and winds every triangle about the normal', () => {
  // an L in a tilted plane, given clockwise about its normal
  const L2 = [[0, 0], [0, 2], [1, 2], [1, 1], [2, 1], [2, 0]];
  const u = norm([1, 0, 1]), w = [0, 1, 0], n = cross(u, w);
  const v = L2.map(([a, b]) => add(scale(u, a), scale(w, b)));
  const tris = triangulate(v, n);
  assert.equal(tris.length, 4);
  near(area3(v, tris), 3, 1e-9);
  for (const [a, b, c] of tris) assert.ok(dot(cross(sub(v[b], v[a]), sub(v[c], v[a])), n) > 0, 'counter-clockwise about n');
});

test('a box primitive has six outward faces and twelve edges', () => {
  const { faces, lines } = fromPrim({ t: 'box', a: [2, 1, 0, 0, 3, 4], m: { l: '#ff0000', m: '#dd0000', d: '#990000' }, cls: 'sun', w: 1 }, shades);
  assert.equal(faces.length, 6);
  assert.equal(lines.length, 12);
  const c = [1, 2, 2];
  for (const f of faces) {
    assert.ok(dot(f.n, sub(avg(f.v), c)) > 0, 'outward');
    nearV(newell(f.v), f.n);           // wound counter-clockwise seen from outside
  }
  assert.equal(faces[0].cls, 'sun');
});

test('cylinders and rods are closed and outward; a cone tip has no cap', () => {
  const cyl = fromPrim({ t: 'cyl', a: [0, 0, 0, 5, 2], n: 12, m: { l: '#888888' }, w: 1 }, shades);
  assert.equal(cyl.faces.length, 14);
  for (const f of cyl.faces) assert.ok(dot(f.n, sub(avg(f.v), [0, 0, 2.5])) > 0);
  const cone = fromPrim({ t: 'rod', a: [0, 0, 0], b: [0, 0, 10], r: 2, r1: 0, n: 8, m: { l: '#888888' }, w: 0 }, shades);
  assert.equal(cone.faces.filter((f) => f.cap).length, 1);
});

test('a filled path keeps its own colour as a flat face; dashed or invisible paths make nothing', () => {
  const pts = [[0, 0, 0], [1, 0, 0], [1, 1, 0]];
  const a = fromPath({ pts, fill: '#123456', stroke: '#231e16', sw: 1, opacity: 1, close: true }, shades);
  assert.equal(a.faces.length, 1);
  assert.equal(a.faces[0].cls, 'flat');
  assert.equal(a.lines.length, 1);
  assert.equal(fromPath({ pts, fill: '#123456', stroke: 'none', opacity: 0.1 }, shades).faces.length, 0);
  assert.equal(fromPath({ pts, fill: 'none', stroke: '#231e16', sw: 1, opacity: 1, dash: '2 2' }, shades).lines.length, 0);
});

test('the rigid fit recovers a turn about an off-origin axis, also on a thin two-blade point set', () => {
  const axis = norm([0.2, 1, -0.1]), angle = 1.1, s = Math.sin(angle / 2), q = [Math.cos(angle / 2), ...scale(axis, s)];
  const pivot = [0.03, 0.01, -0.02];
  const blade = [];
  for (let i = 0; i < 40; i++) { const t = (i / 39 - 0.5) * 0.12; blade.push([t, 0.0005 * (i % 2), 0.002 * (i % 3)]); }
  const moved = blade.map((p) => add(rotate(q, sub(p, pivot)), pivot));
  const fit = fitRigid(blade, moved);
  assert.ok(fit.rms < 1e-9, `rms ${fit.rms}`);
  const aa = axisAngle(fit, pivot);
  near(aa.angle, angle, 1e-9);
  nearV(aa.axis, axis, 1e-9);
  assert.ok(len(cross(sub(aa.pivot, pivot), axis)) < 1e-9, 'pivot on the axis');
});

test('the glb writer makes a file the Khronos validator accepts, with linear colours and the ink attributes', async () => {
  const b = new MeshBatch('static', { explode: true });
  const v = [[0, 0, 0], [0.01, 0, 0], [0.01, 0, -0.01], [0, 0, -0.01]];
  b.addFace(v, triangulate(v, [0, 1, 0]), [0, 1, 0], { l: '#ffffff', m: '#d6d6d6', d: '#949494' }, 'sun', 0, [0, 0.004, 0]);
  b.addLine([v[0], v[1]], '#231e16', 1, 0, [0, 0.004, 0]);
  const ch = new MeshBatch('led:L', { translation: [0.005, 0.002, 0] });
  ch.addFace(v, triangulate(v, [0, 1, 0]), [0, 1, 0], { l: '#f7a531', m: '#cf8a29', d: '#8f5f1c' }, 'fixed', 1, [0, 0, 0]);
  const glb = writeGlb({ name: 'test/item', nodes: [b, ch] });
  const report = await validateGlb(glb);
  assert.equal(report.errors, 0, JSON.stringify(report.issues));
  const jl = glb.readUInt32LE(12), json = JSON.parse(glb.subarray(20, 20 + jl).toString('utf8'));
  assert.deepEqual(json.nodes.map((n) => n.name), ['test/item', 'static', 'led:L']);
  assert.deepEqual(json.nodes[2].translation, [0.005, 0.002, 0]);
  const attrs = json.meshes[0].primitives[0].attributes;
  for (const k of ['POSITION', 'NORMAL', 'COLOR_0', '_INK_MID', '_INK_DARK', '_PART', '_EXPLODE', '_OUTLINE_NORMAL']) assert.ok(k in attrs, k);
  assert.ok('_LINE_WIDTH' in json.meshes[0].primitives[1].attributes);
  assert.equal(json.meshes[0].primitives[1].mode, 1);
  assert.deepEqual(json.materials.map((m) => m.name), ['ink.sun', 'ink.line', 'ink.fixed']);
  near(linear('#808080')[0], 0.2158605, 1e-6);
});

test('the TS type and the JSON schema list the same fields', () => {
  const ts = readFileSync(join(TOOL, 'schema', 'xr-asset.ts'), 'utf8');
  const schema = JSON.parse(readFileSync(join(TOOL, 'schema', 'xr-asset.schema.json'), 'utf8'));
  const fieldsOf = (name) => {
    const start = ts.indexOf(`export interface ${name} {`);
    assert.ok(start >= 0, name);
    const out = new Set();
    let depth = 0;
    const body = ts.slice(start).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const line of body.split('\n').slice(1)) {
      const t = line.trim();
      if (depth === 0) {
        if (t.startsWith('}')) break;
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\??:/.exec(t);
        if (m) out.add(m[1]);
      }
      depth += (t.match(/[{[]/g) || []).length - (t.match(/[}\]]/g) || []).length;
    }
    return [...out].sort();
  };
  const props = (o) => Object.keys(o.properties).sort();
  assert.deepEqual(fieldsOf('XrAsset'), props(schema));
  for (const [ts, js] of [['Part', 'part'], ['Anchor', 'anchor'], ['Channel', 'channel'], ['Layer', 'layer'], ['Text', 'text']]) {
    assert.deepEqual(fieldsOf(ts), props(schema.$defs[js]), ts);
  }
});
