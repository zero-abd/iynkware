/* A small hand-built XR asset (glb + sidecar) in the shape docs/XR_ASSETS.md sections 3 and 4 describe, for the
   viewer and the material tests while no converted asset exists: a board on standoffs with a chip under a cover lid,
   a header, silkscreen and traces, a die and bond wires in the xray layer, and four channel nodes (led:L,
   press:RESET, servo:SRV1, prop:M1). Runs in a browser and in Node (no DOM, no three.js needed).

     import { buildFixture } from './fixture.js';
     const { sidecar, glb } = buildFixture();      // glb: ArrayBuffer */

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16) / 255);
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linHex = (h) => hex(h).map(lin);
const mix = (a, b, t) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.substr(i, 2), 16) * (1 - t) + parseInt(b.substr(i, 2), 16) * t).toString(16).padStart(2, '0')).join('');
const matOf = (h) => ({ l: h, m: mix(h, '#000000', 0.16), d: mix(h, '#000000', 0.42) });
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

const DARK = { l: '#55504a', m: '#3d3935', d: '#272421' };
const METAL = { l: '#eef0f0', m: '#c6ccce', d: '#8f989b' };
const CERAMIC = { l: '#fbfaf3', m: '#e3e0d2', d: '#bdb8a6' };
const INK = '#231e16';

/** One mesh node's geometry, by shading class, plus its lines. Positions are in the node's frame. */
class NodeGeo {
  constructor(origin = [0, 0, 0]) { this.origin = origin; this.tris = { sun: [], fixed: [], flat: [] }; this.lines = []; }
  /** a convex polygon (counter-clockwise seen from outside), outward normal n */
  face(shade, pts, mat, part, explode, n = null) {
    const p = pts.map((q) => sub(q, this.origin));
    const nn = n || norm(cross(sub(p[1], p[0]), sub(p[2], p[0])));
    for (let i = 1; i + 1 < p.length; i++) this.tris[shade].push({ v: [p[0], p[i], p[i + 1]], n: nn, mat, part, explode });
  }
  line(a, b, color = INK, width = 0.9, part = 0, explode = [0, 0, 0]) { this.lines.push({ a: sub(a, this.origin), b: sub(b, this.origin), color, width, part, explode }); }
  box(shade, x0, y0, z0, x1, y1, z1, mat, part, explode, edges = true, w = 0.9) {
    const c = (x, y, z) => [x ? x1 : x0, y ? y1 : y0, z ? z1 : z0];
    const F = [
      [[1, 0, 0], [c(1, 0, 1), c(1, 0, 0), c(1, 1, 0), c(1, 1, 1)]],
      [[-1, 0, 0], [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)]],
      [[0, 1, 0], [c(0, 1, 1), c(1, 1, 1), c(1, 1, 0), c(0, 1, 0)]],
      [[0, -1, 0], [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)]],
      [[0, 0, 1], [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)]],
      [[0, 0, -1], [c(1, 0, 0), c(0, 0, 0), c(0, 1, 0), c(1, 1, 0)]],
    ];
    // the converter does not promise winding: flip one face's order on purpose (normals stay outward)
    F[4][1].reverse();
    for (const [n, q] of F) this.face(shade, q, mat, part, explode, n);
    if (edges) {
      const E = [[0, 0, 0, 1, 0, 0], [0, 1, 0, 1, 1, 0], [0, 0, 1, 1, 0, 1], [0, 1, 1, 1, 1, 1], [0, 0, 0, 0, 1, 0], [1, 0, 0, 1, 1, 0],
        [0, 0, 1, 0, 1, 1], [1, 0, 1, 1, 1, 1], [0, 0, 0, 0, 0, 1], [1, 0, 0, 1, 0, 1], [0, 1, 0, 0, 1, 1], [1, 1, 0, 1, 1, 1]];
      for (const e of E) this.line(c(e[0], e[1], e[2]), c(e[3], e[4], e[5]), INK, w, part, explode);
    }
  }
  /** vertical cylinder centred (x, z) */
  cyl(shade, x, z, y0, y1, r, mat, part, explode, n = 20, w = 0.9) {
    const ring = (y) => Array.from({ length: n }, (_, i) => { const a = i / n * 2 * Math.PI; return [x + r * Math.cos(a), y, z - r * Math.sin(a)]; });
    const A = ring(y0), B = ring(y1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, mid = (i + 0.5) / n * 2 * Math.PI;
      this.face(shade, [A[i], A[j], B[j], B[i]], mat, part, explode, [Math.cos(mid), 0, -Math.sin(mid)]);
    }
    this.face(shade, B, mat, part, explode, [0, 1, 0]);
    this.face(shade, A.slice().reverse(), mat, part, explode, [0, -1, 0]);
    for (let i = 0; i < n; i++) this.line(B[i], B[(i + 1) % n], INK, w, part, explode);
  }
  /** a flat decal on y = const (silkscreen, pads), drawn ink.flat */
  decal(x0, z0, x1, z1, y, colour, part, explode) {
    this.face('flat', [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]], { l: colour, m: colour, d: colour }, part, explode, [0, 1, 0]);
  }
}

/** glTF primitives (one per shading class, one for lines) from a NodeGeo; static nodes carry _EXPLODE */
function primitivesOf(geo, withExplode, w) {
  const prims = [];
  for (const shade of ['sun', 'fixed', 'flat']) {
    const tris = geo.tris[shade];
    if (!tris.length) continue;
    const P = [], N = [], L = [], M = [], D = [], PT = [], X = [];
    for (const t of tris) for (const v of t.v) {
      P.push(...v); N.push(...t.n); L.push(...linHex(t.mat.l)); M.push(...linHex(t.mat.m)); D.push(...linHex(t.mat.d)); PT.push(t.part); X.push(...t.explode);
    }
    // _OUTLINE_NORMAL: the face normals averaged over coincident vertices of one part
    const key = (i) => PT[i] + ':' + [0, 1, 2].map((k) => Math.round(P[3 * i + k] * 1e6)).join(',');
    const sum = new Map(), count = P.length / 3;
    for (let i = 0; i < count; i++) { const k = key(i), s = sum.get(k) || [0, 0, 0]; s[0] += N[3 * i]; s[1] += N[3 * i + 1]; s[2] += N[3 * i + 2]; sum.set(k, s); }
    const O = [];
    for (let i = 0; i < count; i++) { const s = norm(sum.get(key(i))); O.push(...s, 0); }
    const attributes = {
      POSITION: w.accessor(new Float32Array(P), 'VEC3', { minmax: true }),
      NORMAL: w.accessor(new Float32Array(N), 'VEC3'),
      COLOR_0: w.accessor(u16n(L), 'VEC3', { normalized: true }),
      _INK_MID: w.accessor(u16n(M), 'VEC3', { normalized: true }),
      _INK_DARK: w.accessor(u16n(D), 'VEC3', { normalized: true }),
      _PART: w.accessor(new Uint16Array(PT), 'SCALAR'),
      _OUTLINE_NORMAL: w.accessor(new Int8Array(O.map((x) => Math.round(x * 127))), 'VEC4', { normalized: true }),
    };
    if (withExplode) attributes._EXPLODE = w.accessor(new Float32Array(X), 'VEC3');
    const indices = w.accessor(new Uint16Array(Array.from({ length: count }, (_, i) => i)), 'SCALAR', { target: 34963 });
    prims.push({ attributes, indices, material: w.material(shade), mode: 4 });
  }
  if (geo.lines.length) {
    const P = [], C = [], W = [], PT = [], X = [];
    for (const l of geo.lines) for (const p of [l.a, l.b]) { P.push(...p); C.push(...linHex(l.color)); W.push(l.width); PT.push(l.part); X.push(...l.explode); }
    const attributes = {
      POSITION: w.accessor(new Float32Array(P), 'VEC3', { minmax: true }),
      COLOR_0: w.accessor(u16n(C), 'VEC3', { normalized: true }),
      _LINE_WIDTH: w.accessor(new Float32Array(W), 'SCALAR'),
      _PART: w.accessor(new Uint16Array(PT), 'SCALAR'),
    };
    if (withExplode) attributes._EXPLODE = w.accessor(new Float32Array(X), 'VEC3');
    prims.push({ attributes, material: w.material('line'), mode: 1 });
  }
  return prims;
}
const u16n = (a) => new Uint16Array(a.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 65535)));

/** A minimal glb writer: one buffer, one bufferView per accessor, 4-byte aligned strides. */
class GlbWriter {
  constructor() { this.json = { asset: { version: '2.0', generator: 'iynkware tools/xr-assets viewer/fixture.js' }, buffers: [], bufferViews: [], accessors: [], materials: [], meshes: [], nodes: [], scenes: [], scene: 0 }; this.chunks = []; this.length = 0; this.mats = {}; }
  accessor(arr, type, { normalized = false, minmax = false, target = 34962 } = {}) {
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const ctype = arr instanceof Float32Array ? 5126 : arr instanceof Uint16Array ? 5123 : arr instanceof Int8Array ? 5120 : arr instanceof Uint32Array ? 5125 : 5121;
    const elBytes = comps * arr.BYTES_PER_ELEMENT, count = arr.length / comps;
    const stride = target === 34962 ? Math.ceil(elBytes / 4) * 4 : elBytes;
    const bytes = new Uint8Array(count * stride);
    const src = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < count; i++) bytes.set(src.subarray(i * elBytes, (i + 1) * elBytes), i * stride);
    const view = { buffer: 0, byteOffset: this.length, byteLength: bytes.length, target };
    if (target === 34962 && stride !== elBytes) view.byteStride = stride;
    this.chunks.push(bytes);
    this.length += bytes.length;
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) { this.chunks.push(new Uint8Array(pad)); this.length += pad; }
    this.json.bufferViews.push(view);
    const acc = { bufferView: this.json.bufferViews.length - 1, componentType: ctype, count, type };
    if (normalized) acc.normalized = true;
    if (minmax) {
      const mn = new Array(comps).fill(Infinity), mx = new Array(comps).fill(-Infinity);
      for (let i = 0; i < count; i++) for (let c = 0; c < comps; c++) { mn[c] = Math.min(mn[c], arr[i * comps + c]); mx[c] = Math.max(mx[c], arr[i * comps + c]); }
      acc.min = mn; acc.max = mx;
    }
    this.json.accessors.push(acc);
    return this.json.accessors.length - 1;
  }
  /** one material per shading class per mesh (a channel node gets its own, so lighting one LED lights no other) */
  material(shade) {
    this.json.materials.push({ name: 'ink.' + shade, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: shade !== 'line', extras: { iynkInk: { shade } } });
    return this.json.materials.length - 1;
  }
  mesh(name, primitives) { this.json.meshes.push({ name, primitives }); return this.json.meshes.length - 1; }
  node(def) { this.json.nodes.push(def); return this.json.nodes.length - 1; }
  finish(rootNode) {
    this.json.scenes.push({ nodes: [rootNode] });
    this.json.buffers.push({ byteLength: this.length });
    const enc = new TextEncoder();
    let js = enc.encode(JSON.stringify(this.json));
    const jpad = (4 - (js.length % 4)) % 4;
    const jsonChunk = new Uint8Array(js.length + jpad); jsonChunk.set(js); jsonChunk.fill(0x20, js.length);
    const total = 12 + 8 + jsonChunk.length + 8 + this.length;
    const out = new ArrayBuffer(total), dv = new DataView(out), u8 = new Uint8Array(out);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jsonChunk.length, true); dv.setUint32(16, 0x4e4f534a, true); u8.set(jsonChunk, 20);
    let o = 20 + jsonChunk.length;
    dv.setUint32(o, this.length, true); dv.setUint32(o + 4, 0x004e4942, true); o += 8;
    for (const c of this.chunks) { u8.set(c, o); o += c.length; }
    return out;
  }
}

/** Builds the fixture: { sidecar, glb } */
export function buildFixture() {
  const id = 'fixtures/ink-board';
  const mm = 0.001;
  const top = 4.6 * mm;                       // the board's top surface
  const ex = { smd: [0, 4 * mm, 0], low: [0, 9 * mm, 0], tall: [0, 14 * mm, 0], last: [0, 19 * mm, 0], none: [0, 0, 0] };
  const parts = [
    { id: '', index: 0, name: 'Ink fixture', parent: '', role: 'item', explode: ex.none },
    { id: 'PCB', index: 1, name: 'Board', parent: '', role: 'board', explode: ex.none },
    { id: 'U1', index: 2, name: 'Chip', parent: 'PCB', role: 'part', explode: ex.smd, group: 'smd' },
    { id: 'J1', index: 3, name: 'Header', parent: 'PCB', role: 'connector', explode: ex.tall, group: 'tall' },
    { id: 'L', index: 4, name: 'LED L', parent: 'PCB', role: 'led', explode: ex.smd, group: 'smd', nodes: ['led:L'] },
    { id: 'RESET', index: 5, name: 'Reset button', parent: 'PCB', role: 'control', explode: ex.low, group: 'low', nodes: ['press:RESET'] },
    { id: 'SRV1', index: 6, name: 'Servo', parent: 'PCB', role: 'motor', explode: ex.tall, group: 'tall', nodes: ['servo:SRV1'] },
    { id: 'M1', index: 7, name: 'Motor and prop', parent: 'PCB', role: 'motor', explode: ex.last, group: 'last', nodes: ['prop:M1'] },
    { id: 'LID', index: 8, name: 'Cover lid', parent: 'PCB', role: 'cover', explode: ex.last, group: 'last', cover: true },
    { id: 'STANDOFFS', index: 9, name: 'Standoffs', parent: '', role: 'part', explode: ex.none },
  ];
  const E = (p) => parts[p].explode;
  const board = { l: '#2f8f83', m: '#277a70', d: '#1b544d' };
  const gold = '#e2b13c', silk = '#f4f1e6';

  // static
  const S = new NodeGeo();
  S.box('sun', -30 * mm, 3 * mm, -20 * mm, 30 * mm, top, 20 * mm, board, 1, E(1), true, 0.9);
  for (const [x, z] of [[-27, -17], [27, -17], [-27, 17], [27, 17]]) S.cyl('fixed', x * mm, z * mm, 0, 3 * mm, 1.6 * mm, METAL, 9, E(9), 12, 0.7);
  S.box('fixed', -12 * mm, top, -6 * mm, 2 * mm, 7.6 * mm, 6 * mm, DARK, 2, E(2), true, 0.9);
  S.box('fixed', -25 * mm, top, -18 * mm, 5 * mm, 13.1 * mm, -15.5 * mm, DARK, 3, E(3), true, 0.9);
  for (let i = 0; i < 8; i++) { const x = -23.6 * mm + i * 2.54 * mm; S.decal(x - 0.5 * mm, -17.25 * mm, x + 0.5 * mm, -16.25 * mm, 13.1 * mm, '#1a1714', 3, E(3)); }
  S.box('fixed', 8 * mm, top, -16 * mm, 28 * mm, 20.6 * mm, -4 * mm, matOf('#5a82c6'), 6, E(6), true, 0.9);
  S.cyl('fixed', 13 * mm, -10 * mm, 20.6 * mm, 21.6 * mm, 1.2 * mm, CERAMIC, 6, E(6), 12, 0.6);
  S.box('fixed', 18 * mm, top, 10 * mm, 24 * mm, 8.1 * mm, 16 * mm, METAL, 5, E(5), true, 0.9);
  S.cyl('fixed', -20 * mm, 12 * mm, top, 10.6 * mm, 4 * mm, METAL, 7, E(7), 20, 1);
  // silkscreen (coplanar with the board's top: ink.flat must win) and pads
  S.decal(-14 * mm, -8 * mm, 4 * mm, -7.4 * mm, top, silk, 1, E(1));
  S.decal(-14 * mm, 7.4 * mm, 4 * mm, 8 * mm, top, silk, 1, E(1));
  S.decal(10 * mm, 7 * mm, 16 * mm, 17 * mm, top, silk, 1, E(1));
  for (let i = 0; i < 6; i++) S.decal(-28 * mm, (-6 + i * 2.4) * mm, -26 * mm, (-5 + i * 2.4) * mm, top, gold, 1, E(1));
  for (let i = 0; i < 6; i++) S.line([-26 * mm, top, (-5.5 + i * 2.4) * mm], [-12 * mm, top, (-5.5 + i * 2.4) * mm], '#c9a43d', 0.6, 1, E(1));
  // cover: a lid over the chip
  const C = new NodeGeo();
  C.box('sun', -16 * mm, top, -10 * mm, 6 * mm, 9.6 * mm, 10 * mm, matOf('#76a0e2'), 8, E(8), true, 1);
  // xray: the die and its bond wires
  const X = new NodeGeo();
  X.box('fixed', -8 * mm, 6 * mm, -3 * mm, -2 * mm, 6.6 * mm, 3 * mm, { l: '#b9c2c7', m: '#97a1a6', d: '#6d777c' }, 2, E(2), true, 0.4);
  for (let i = 0; i < 5; i++) X.line([-7.5 * mm + i * 1.3 * mm, 6.6 * mm, 2.8 * mm], [-11.5 * mm + i * 3 * mm, 6.2 * mm, 5.6 * mm], gold, 0.4, 2, E(2));
  // channel nodes, in their own frame (translation = pivot or part centre)
  const ledAt = [12.8 * mm, top, 8.4 * mm];
  const LED = new NodeGeo(ledAt);
  LED.box('fixed', 12 * mm, top, 8 * mm, 13.6 * mm, 5.4 * mm, 8.8 * mm, matOf('#e8c46a'), 4, E(4), true, 0.6);
  const btnAt = [21 * mm, 8.1 * mm, 13 * mm];
  const BTN = new NodeGeo(btnAt);
  BTN.cyl('fixed', 21 * mm, 13 * mm, 8.1 * mm, 9.3 * mm, 1.75 * mm, DARK, 5, E(5), 16, 0.8);
  const servoPivot = [13 * mm, 21.6 * mm, -10 * mm];
  const SRV = new NodeGeo(servoPivot);
  SRV.box('fixed', 11.8 * mm, 21.6 * mm, -11 * mm, 27 * mm, 22.8 * mm, -9 * mm, CERAMIC, 6, E(6), true, 0.8);
  const propPivot = [-20 * mm, 10.6 * mm, 12 * mm];
  const PROP = new NodeGeo(propPivot);
  PROP.cyl('fixed', -20 * mm, 12 * mm, 10.6 * mm, 12.4 * mm, 1.6 * mm, METAL, 7, E(7), 12, 0.8);
  PROP.box('sun', -33 * mm, 11.4 * mm, 11 * mm, -7 * mm, 11.9 * mm, 13 * mm, matOf('#93d3b0'), 7, E(7), true, 0.8);

  const w = new GlbWriter();
  const meshNode = (name, geo, explode, translation) => {
    const m = w.mesh(name, primitivesOf(geo, explode, w));
    const n = { name, mesh: m };
    if (translation) n.translation = translation;
    return w.node(n);
  };
  const kids = [
    meshNode('static', S, true), meshNode('static.cover', C, true), meshNode('static.xray', X, true),
    meshNode('led:L', LED, false, ledAt), meshNode('press:RESET', BTN, false, btnAt),
    meshNode('servo:SRV1', SRV, false, servoPivot), meshNode('prop:M1', PROP, false, propPivot),
  ];
  const root = w.node({ name: id, children: kids });
  const glb = w.finish(root);

  // bounds of all geometry at rest
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const [g, o] of [[S, null], [C, null], [X, null], [LED, ledAt], [BTN, btnAt], [SRV, servoPivot], [PROP, propPivot]]) {
    for (const sh of Object.values(g.tris)) for (const t of sh) for (const v of t.v) for (let k = 0; k < 3; k++) { const x = v[k] + (o ? o[k] : 0); mn[k] = Math.min(mn[k], x); mx[k] = Math.max(mx[k], x); }
  }
  const pb = (x0, y0, z0, x1, y1, z1) => ({ min: [x0 * mm, y0 * mm, z0 * mm], max: [x1 * mm, y1 * mm, z1 * mm] });
  const bounds = { PCB: pb(-30, 3, -20, 30, 4.6, 20), U1: pb(-12, 4.6, -6, 2, 7.6, 6), J1: pb(-25, 4.6, -18, 5, 13.1, -15.5), L: pb(12, 4.6, 8, 13.6, 5.4, 8.8),
    RESET: pb(18, 4.6, 10, 24, 9.3, 16), SRV1: pb(8, 4.6, -16, 28, 22.8, -4), M1: pb(-33, 4.6, 8, -7, 12.4, 16), LID: pb(-16, 4.6, -10, 6, 9.6, 10), STANDOFFS: pb(-28.6, 0, -18.6, 28.6, 3, 18.6) };
  for (const p of parts) if (bounds[p.id]) p.bounds = bounds[p.id];
  parts[0].bounds = { min: mn, max: mx };

  const pins = Array.from({ length: 8 }, (_, i) => ({ id: 'D' + i, kind: 'pin', part: 'J1', position: [-23.6 * mm + i * 2.54 * mm, 13.1 * mm, -16.75 * mm], normal: [0, 1, 0], depth: 6 * mm, aliases: ['J1.' + (i + 1)] }));
  const sidecar = {
    schema: 'iynkware.xr-asset/1', id, kind: 'board', name: 'Ink fixture board', glb: 'ink-board.glb',
    source: { figure: 'tools/xr-assets/viewer/fixture.js', engine: 'bench', pageSha256: '0'.repeat(64) },
    generator: { tool: 'tools/xr-assets', version: 'fixture' },
    frame: { units: 'm', up: '+Y', front: '+Z', handedness: 'right', origin: 'footprint-centre', source: 'board-mm', fromSource: [0.001, 0, 0, 0, 0, 0, -0.001, 0, 0, 0.001, 0, 0, 0, 0, 0, 1] },
    bounds: { min: mn, max: mx },
    stats: { triangles: 0, trianglesXray: 0, drawCalls: 0, lineSegments: 0, nodes: kids.length + 1, bytes: glb.byteLength },
    look: { ink: INK, paper: '#f2efe7', shadow: '#41538f', sun: norm([-0.324, 0.762, -0.561]), fixedLight: norm([0.6, 1, 0.2]), defaultView: norm([1, 1, 1]), shadowLength: 0.45 },
    parts,
    anchors: [
      ...pins,
      { id: 'header:J1', kind: 'header', part: 'J1', position: [-14.71 * mm, 13.1 * mm, -16.75 * mm], normal: [0, 1, 0], members: pins.map((p) => p.id) },
      { id: 'led:L', kind: 'led', part: 'L', position: [12.8 * mm, 5.4 * mm, 8.4 * mm], normal: [0, 1, 0], channel: 'led:L' },
      { id: 'control:RESET', kind: 'control', part: 'RESET', position: [21 * mm, 9.3 * mm, 13 * mm], normal: [0, 1, 0], channel: 'press:RESET' },
      { id: 'prop:M1', kind: 'prop', part: 'M1', position: [-20 * mm, 12.4 * mm, 12 * mm], normal: [0, 1, 0], dir: 'CW', channel: 'prop:M1' },
      { id: 'label:U1', kind: 'label', part: 'U1', position: [-5 * mm, 7.6 * mm, 0], normal: [0, 1, 0], up: [0, 0, -1], text: 'Chip' },
      { id: 'SRV1/HORN', kind: 'pin', part: 'SRV1', position: [26 * mm, 22.8 * mm, -10 * mm], normal: [0, 1, 0], channel: 'servo:SRV1' },
    ],
    channels: [
      { id: 'led:L', kind: 'emissive', part: 'L', nodes: ['led:L'], value: { unit: 'level', min: 0, max: 1, rest: 0 }, color: '#ffb52e', bind: { source: 'net', key: 'D13' } },
      { id: 'press:RESET', kind: 'translate', part: 'RESET', nodes: ['press:RESET'], value: { unit: 'press', min: 0, max: 1, rest: 0 }, axis: [0, -1, 0], scale: 0.6 * mm, bind: { source: 'press', key: 'RESET' } },
      { id: 'servo:SRV1', kind: 'rotate', part: 'SRV1', nodes: ['servo:SRV1'], value: { unit: 'deg', min: 0, max: 180, rest: 90 }, axis: [0, 1, 0], pivot: servoPivot, scale: Math.PI / 180, bind: { source: 'param', key: 'SRV1.angle' } },
      { id: 'prop:M1', kind: 'spin', part: 'M1', nodes: ['prop:M1'], value: { unit: 'rpm', min: 0, max: 12000, rest: 0 }, axis: [0, 1, 0], pivot: propPivot, scale: -1, bind: { source: 'motor', key: 'M1' } },
    ],
    layers: [
      { id: 'base', nodes: ['static', 'led:L', 'press:RESET', 'servo:SRV1', 'prop:M1'], opacity: [1, 1] },
      { id: 'cover', nodes: ['static.cover'], opacity: [1, 0.28] },
      { id: 'xray', nodes: ['static.xray'], opacity: [0, 1] },
    ],
    texts: [
      { part: 'PCB', text: 'INK FIXTURE', position: [-4 * mm, top, 16 * mm], normal: [0, 1, 0], up: [0, 0, -1], size: 1.6 * mm, color: silk, weight: 700, layer: 'base' },
      { part: 'PCB', text: 'RESET', position: [21 * mm, top, 18.6 * mm], normal: [0, 1, 0], up: [0, 0, -1], size: 0.9 * mm, color: silk, weight: 700, layer: 'base' },
    ],
    warnings: ['A hand-built fixture, not a converted figure.'],
  };
  // stats as the converter counts them
  let tris = 0, trisX = 0, calls = 0, segs = 0;
  for (const [g, layer] of [[S, 'base'], [C, 'cover'], [X, 'xray'], [LED], [BTN], [SRV], [PROP]]) {
    const t = Object.values(g.tris).reduce((a, s) => a + s.length, 0);
    if (layer === 'xray') { trisX += t; continue; }
    tris += t; segs += g.lines.length;
    calls += Object.values(g.tris).filter((s) => s.length).length + (g.lines.length ? 1 : 0);
  }
  Object.assign(sidecar.stats, { triangles: tris, trianglesXray: trisX, drawCalls: calls, lineSegments: segs });
  return { sidecar, glb };
}
