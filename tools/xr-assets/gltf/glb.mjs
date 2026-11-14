// A small binary glTF 2.0 writer for the XR asset contract (docs/XR_ASSETS.md section 3): nodes under one root, one
// triangle primitive per shading class and one line primitive per mesh node, the ink attributes, no textures and no
// compression. Vertex elements are 4-byte aligned (unsigned short vec3 colours use a stride of 8).
const FLOAT = 5126, USHORT = 5123, UINT = 5125, BYTE = 5120;
const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linCache = new Map();
/** '#rrggbb' to linear [r, g, b] in 0..1. */
export function linear(hex) {
  let v = linCache.get(hex);
  if (!v) { v = [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.substr(i, 2), 16) / 255)); linCache.set(hex, v); }
  return v;
}

/** Collects one mesh node's geometry: triangles per shading class and lines. Positions are node-local, metres. */
export class MeshBatch {
  constructor(name, { translation = [0, 0, 0], explode = false, extras = {} } = {}) {
    this.name = name; this.translation = translation; this.explode = explode; this.extras = extras;
    this.tris = {}; this.lines = null;
  }
  _cls(cls) { return this.tris[cls] || (this.tris[cls] = { pos: [], nor: [], l: [], m: [], d: [], part: [], ex: [], on: [], idx: [] }); }
  /** A planar face: v (local positions), n (unit normal), mat {l,m,d}, cls, part index, explode offset, outline normals per vertex. */
  addFace(v, tris, n, mat, cls, part, ex, on) {
    const b = this._cls(cls), base = b.pos.length / 3;
    const L = linear(mat.l), M = linear(mat.m), D = linear(mat.d);
    for (let i = 0; i < v.length; i++) {
      b.pos.push(v[i][0], v[i][1], v[i][2]); b.nor.push(n[0], n[1], n[2]);
      b.l.push(...L); b.m.push(...M); b.d.push(...D); b.part.push(part); b.ex.push(ex[0], ex[1], ex[2]);
      const o = on ? on[i] : n; b.on.push(o[0], o[1], o[2]);
    }
    for (const [a, c, e] of tris) b.idx.push(base + a, base + c, base + e);
  }
  addLine(pts, col, w, part, ex) {
    const b = this.lines || (this.lines = { pos: [], col: [], part: [], ex: [], w: [], idx: [] });
    const C = linear(col), base = b.pos.length / 3;
    for (const p of pts) { b.pos.push(p[0], p[1], p[2]); b.col.push(...C); b.part.push(part); b.ex.push(ex[0], ex[1], ex[2]); b.w.push(w); }
    for (let i = 0; i + 1 < pts.length; i++) b.idx.push(base + i, base + i + 1);
  }
  get triangleCount() { return Object.values(this.tris).reduce((s, b) => s + b.idx.length / 3, 0); }
  get segmentCount() { return this.lines ? this.lines.idx.length / 2 : 0; }
  get primitiveCount() { return Object.values(this.tris).filter((b) => b.idx.length).length + (this.segmentCount ? 1 : 0); }
  get empty() { return !this.triangleCount && !this.segmentCount; }
}

const SHADES = ['sun', 'fixed', 'flat'];

/** Writes a .glb. root: { name, extras, nodes: MeshBatch[] }. Returns a Buffer. */
export function writeGlb(root) {
  const chunks = [];
  let byteLength = 0;
  const json = {
    asset: { version: '2.0', generator: 'iynkware tools/xr-assets' },
    scene: 0, scenes: [{ name: root.name, nodes: [0] }],
    nodes: [{ name: root.name, children: [], extras: root.extras || {} }],
    meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [],
  };
  const view = (bytes, target, stride) => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); byteLength += pad; }
    const v = { buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength };
    if (target) v.target = target;
    if (stride) v.byteStride = stride;
    chunks.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)); byteLength += bytes.byteLength;
    json.bufferViews.push(v);
    return json.bufferViews.length - 1;
  };
  const accessor = (a) => { json.accessors.push(a); return json.accessors.length - 1; };
  const f32 = (arr, type, withMinMax = false) => {
    const data = Float32Array.from(arr), n = type === 'VEC3' ? 3 : 1;
    const a = { bufferView: view(data, ARRAY_BUFFER), componentType: FLOAT, count: data.length / n, type };
    if (withMinMax) {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < data.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], data[i + k]); mx[k] = Math.max(mx[k], data[i + k]); }
      a.min = mn; a.max = mx;
    }
    return accessor(a);
  };
  const u16vec3 = (arr) => {   // normalized unsigned short vec3, stride 8
    const count = arr.length / 3, data = new Uint16Array(count * 4);
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.round(Math.min(1, Math.max(0, arr[i * 3 + k])) * 65535);
    return accessor({ bufferView: view(data, ARRAY_BUFFER, 8), componentType: USHORT, normalized: true, count, type: 'VEC3' });
  };
  const u16 = (arr) => {       // unsigned short scalar, stride 4
    const data = new Uint16Array(arr.length * 2);
    for (let i = 0; i < arr.length; i++) data[i * 2] = arr[i];
    return accessor({ bufferView: view(data, ARRAY_BUFFER, 4), componentType: USHORT, count: arr.length, type: 'SCALAR' });
  };
  const i8vec4 = (arr) => {    // normalized byte vec4 (w = 0)
    const count = arr.length / 3, data = new Int8Array(count * 4);
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) data[i * 4 + k] = Math.round(Math.min(1, Math.max(-1, arr[i * 3 + k])) * 127);
    return accessor({ bufferView: view(data, ARRAY_BUFFER), componentType: BYTE, normalized: true, count, type: 'VEC4' });
  };
  const indices = (idx, count) => {
    const data = count < 65536 ? Uint16Array.from(idx) : Uint32Array.from(idx);
    return accessor({ bufferView: view(data, ELEMENT_ARRAY_BUFFER), componentType: count < 65536 ? USHORT : UINT, count: idx.length, type: 'SCALAR' });
  };
  const material = (shade, extra = {}) => {
    const m = { name: 'ink.' + shade, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, extras: { iynkInk: { shade, ...extra } } };
    if (shade !== 'line') m.doubleSided = true;
    json.materials.push(m);
    return json.materials.length - 1;
  };

  for (const batch of root.nodes) {
    if (batch.empty) continue;
    const prims = [];
    for (const cls of SHADES) {
      const b = batch.tris[cls];
      if (!b || !b.idx.length) continue;
      const count = b.pos.length / 3;
      const attributes = { POSITION: f32(b.pos, 'VEC3', true), NORMAL: f32(b.nor, 'VEC3'), COLOR_0: u16vec3(b.l), _INK_MID: u16vec3(b.m), _INK_DARK: u16vec3(b.d),
        _PART: u16(b.part), _OUTLINE_NORMAL: i8vec4(b.on) };
      if (batch.explode) attributes._EXPLODE = f32(b.ex, 'VEC3');
      prims.push({ attributes, indices: indices(b.idx, count), material: material(cls), mode: 4 });
    }
    if (batch.lines && batch.lines.idx.length) {
      const b = batch.lines, count = b.pos.length / 3;
      const attributes = { POSITION: f32(b.pos, 'VEC3', true), COLOR_0: u16vec3(b.col), _PART: u16(b.part), _LINE_WIDTH: f32(b.w, 'SCALAR') };
      if (batch.explode) attributes._EXPLODE = f32(b.ex, 'VEC3');
      prims.push({ attributes, indices: indices(b.idx, count), material: material('line'), mode: 1 });
    }
    json.meshes.push({ name: batch.name, primitives: prims });
    const node = { name: batch.name, mesh: json.meshes.length - 1, extras: { ...batch.extras } };
    if (batch.translation.some((v) => v !== 0)) node.translation = batch.translation;
    json.nodes.push(node);
    json.nodes[0].children.push(json.nodes.length - 1);
  }
  if (!json.nodes[0].children.length) delete json.nodes[0].children;
  const bin = Buffer.concat(chunks);
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  json.buffers.push({ byteLength: binPadded.length });
  for (const k of ['meshes', 'materials', 'accessors', 'bufferViews']) if (!json[k].length) delete json[k];
  if (!binPadded.length) { delete json.buffers; }
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const total = 12 + 8 + jsonBuf.length + (binPadded.length ? 8 + binPadded.length : 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const parts = [header, jh, jsonBuf];
  if (binPadded.length) { const bh = Buffer.alloc(8); bh.writeUInt32LE(binPadded.length, 0); bh.writeUInt32LE(0x004e4942, 4); parts.push(bh, binPadded); }
  return Buffer.concat(parts);
}
