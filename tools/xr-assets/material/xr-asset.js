/* loadXrAsset(): an iynk XR asset (docs/XR_ASSETS.md) loaded with three's GLTFLoader, its materials replaced by the
   ink look (ink.js), with silhouettes and cast shadows added, and its sidecar's channels, layers, explode and anchors
   wired to a small API (section 7):

     const uno = await loadXrAsset('/xr-assets/boards/uno-r3.json');
     scene.add(uno.object);
     uno.set('led:L', 1); uno.set('press:RESET', 1); uno.explode(0.5); uno.seeThrough(1);
     const d13 = uno.anchor('D13');     // { ...anchor, position: Vector3 (world), normal: Vector3 (world) }
     renderer.setAnimationLoop(() => { uno.update(clock.getDelta()); renderer.render(scene, camera); });

   Node names: GLTFLoader strips '.', ':', '/', '[' and ']' from object names ('led:L' becomes 'ledL',
   'static.cover' becomes 'staticcover') and keeps the glTF name in userData.name, so nodes are looked up by
   userData.name here (asset.node('led:L')). Plain three.js; imports only 'three' and its GLTFLoader. */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  createInkUniforms, createInkMaterial, createLineMaterial, createFatLines, createOutline, createShadow,
  setInkOpacity, setInkEmissive, shadeOf, updateInkLights, hull2d, hullWeight, viewBasis, clamp01, smoothstep,
  withLogDepthVertex, withLogDepthFragment, HULL_MAX, INK, PAPER, SHADOW,
} from './ink.js';

export { INK, PAPER, SHADOW };

const STATIC_NODES = ['static', 'static.cover', 'static.xray'];
const absUrl = (u) => {
  try { return new URL(u).href; } catch { /* relative */ }
  const base = (globalThis.location && globalThis.location.href) || 'file:///';
  return new URL(u, base).href;
};

/**
 * Loads `<id>.json` and the glb it names (resolved next to it) and returns the asset (see createXrAsset).
 * options: loader (a GLTFLoader to reuse), manager (a THREE.LoadingManager), and, to skip the network, sidecar (the
 * parsed JSON) and glb (an ArrayBuffer); plus every createXrAsset option.
 */
export async function loadXrAsset(sidecarUrl, options = {}) {
  const { loader = null, manager = undefined } = options;
  const base = absUrl(sidecarUrl);
  const sidecar = options.sidecar || await new THREE.FileLoader(manager).setResponseType('json').loadAsync(base);
  const gltfLoader = loader || new GLTFLoader(manager);
  const glbUrl = new URL(sidecar.glb, base).href;
  const gltf = options.glb
    ? await gltfLoader.parseAsync(options.glb, glbUrl.replace(/[^/]*$/, ''))
    : await gltfLoader.loadAsync(glbUrl);
  return createXrAsset(gltf, sidecar, options);
}

/* ---------- channel maths (pure; tested in test/material.test.mjs) ---------- */
const vec = (a, d = [0, 0, 0]) => new THREE.Vector3(...(Array.isArray(a) && a.length === 3 ? a : d));
const lerp = (a, b, t) => a + (b - a) * t;
/** A channel value clamped to its range. */
export function clampValue(ch, v) {
  const lo = Math.min(ch.value.min, ch.value.max), hi = Math.max(ch.value.min, ch.value.max);
  return Math.min(hi, Math.max(lo, Number(v) || 0));
}
/** rotate: the angle in radians the node is turned from rest at `deg`. */
export const rotateAngle = (ch, deg) => (ch.scale != null ? ch.scale : Math.PI / 180) * (clampValue(ch, deg) - ch.value.rest);
/** spin: radians per second at `rpm`. */
export const spinRate = (ch, rpm) => (ch.scale != null ? ch.scale : 1) * rpm * 2 * Math.PI / 60;
/** translate: the offset in metres at `press`. */
export const translateOffset = (ch, v) => vec(ch.axis, [0, -1, 0]).normalize().multiplyScalar((ch.scale != null ? ch.scale : 0) * clampValue(ch, v));
/** emissive: { color '#rrggbb', level 0..1 } for a level (number) or rgb ([r, g, b]) value. */
export function emissiveOf(ch, value) {
  if (ch.value.unit === 'rgb') {
    const rgb = (Array.isArray(value) ? value : [value, value, value]).map((x) => clamp01(Number(x) || 0));
    const level = Math.max(...rgb);
    if (level <= 0) return { color: '#000000', level: 0 };
    const hex = '#' + rgb.map((x) => Math.round(x / level * 255).toString(16).padStart(2, '0')).join('');
    return { color: hex, level };
  }
  const span = ch.value.max - ch.value.min;
  const level = span > 0 ? clamp01((clampValue(ch, value) - ch.value.min) / span) : clamp01(Number(value) || 0);
  return { color: ch.color || '#ffffff', level };
}
/**
 * A channel node's local transform (its parent is the item root) from its rest position, the explode offset, and
 * the angle (rotate / spin, about axis through pivot) or offset (translate) of the channels that drive it.
 * Returns { position, quaternion }.
 */
export function nodePose(rest, explodeOffset, explodeT, motions = []) {
  const position = rest.position.clone(), quaternion = rest.quaternion.clone();
  for (const m of motions) {
    if (m.angle != null) {
      const q = new THREE.Quaternion().setFromAxisAngle(m.axis, m.angle);
      const pivot = m.pivot || rest.position;
      position.sub(pivot).applyQuaternion(q).add(pivot);
      quaternion.premultiply(q);
    }
    if (m.offset) position.add(m.offset);
  }
  position.addScaledVector(explodeOffset, explodeT);
  return { position, quaternion };
}

/**
 * Silhouette weights per _PART index (hullInk): each part's bounds projected on the default view, as a share of the
 * item's projected width, through hullWeight. Parts with no bounds get 1.4 (hullInk's default).
 */
export function partWeights(sidecar) {
  const view = (sidecar.look && sidecar.look.defaultView) || [0.577, 0.577, 0.577];
  const [r, u] = viewBasis(view);
  const corners = (b) => {
    const out = [];
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]);
      out.push([p.dot(r), p.dot(u)]);
    }
    return out;
  };
  const all = sidecar.bounds ? corners(sidecar.bounds) : null;
  const frame = all ? (Math.max(...all.map((p) => p[0])) - Math.min(...all.map((p) => p[0]))) * 1.25 : 0;
  const w = new Map();
  for (const p of sidecar.parts || []) w.set(p.index, p.bounds && frame ? hullWeight(hull2d(corners(p.bounds)), frame, HULL_MAX) : 1.4);
  return w;
}

/**
 * Builds the asset from a loaded glTF ({ scene }) and its sidecar.
 * options:
 *   lines: 'fat' (default: quads as wide as the figure's strokes) | 'gl' (1-px GL lines)
 *   outlines: true | 'static' (hulls on static nodes only: one draw call less per channel node) | false
 *   hull: 'back' (only copies of faces turned away are pushed out) | 'all' (every copy, pushed further back: open
 *   shells with no bottom or back still get a rim)
 *   shadows: true; channelShadows: 'moving' (rotate and spin nodes, and channel nodes a quarter of the item's size
 *   or more, default) | 'all' | 'none'
 *   inkScale: 1 (multiplies the ink widths); xrayPull: metres the xray layer is drawn towards the eye (default
 *   from the item's size); planeY: 0 (the shadow plane in the root frame); texts: false (draw sidecar.texts)
 */
export function createXrAsset(gltf, sidecar, options = {}) {
  const opts = { lines: 'fat', outlines: true, hull: 'back', shadows: true, channelShadows: 'moving', inkScale: 1, planeY: 0, texts: false, ...options };
  const look = sidecar.look || {};
  const object = gltf.scene || gltf;
  // glTF node names (userData.name) first, three's sanitised names as a fallback
  const byName = new Map();
  object.traverse((o) => { if (o.userData && o.userData.name != null && !byName.has(o.userData.name)) byName.set(o.userData.name, o); });
  object.traverse((o) => { if (o.name && !byName.has(o.name)) byName.set(o.name, o); });
  const root = (byName.get(sidecar.id) !== object && byName.get(sidecar.id)) || (object.children.length === 1 ? object.children[0] : object);
  if (!object.name) object.name = 'xr:' + sidecar.id;
  const uniforms = createInkUniforms(look);
  const parts = sidecar.parts || [], partsById = new Map(parts.map((p) => [p.id, p]));
  const anchors = new Map((sidecar.anchors || []).map((a) => [a.id, a]));
  const weights = partWeights(sidecar);
  const diag = sidecar.bounds ? vec(sidecar.bounds.max).sub(vec(sidecar.bounds.min)).length() : 0.1;
  const xrayPull = opts.xrayPull != null ? opts.xrayPull : Math.min(0.012, Math.max(0.002, 0.04 * diag));

  // the mesh node (a direct child of the root) each drawable belongs to, and its layer
  const layerOfNode = new Map();
  for (const l of sidecar.layers || []) for (const n of l.nodes || []) layerOfNode.set(n, l.id);
  const nodeOf = (o) => { while (o.parent && o.parent !== root) o = o.parent; return o.parent === root ? o : null; };
  const nameOf = (o) => (o.userData && o.userData.name != null ? o.userData.name : o.name);

  /** per mesh node: { node, name, layer, bodies: [mesh], solids: [mesh], lines: [obj], materials: [mat], outline, shadow } */
  const nodes = new Map();
  const nodeEntry = (node) => {
    let e = nodes.get(node);
    if (!e) {
      const name = nameOf(node);
      e = { node, name, layer: layerOfNode.get(name) || (name === 'static.cover' ? 'cover' : name === 'static.xray' ? 'xray' : 'base'),
        bodies: [], solids: [], lines: [], materials: [], outlines: [], shadows: [], visible: true, layerVisible: true };
      nodes.set(node, e);
    }
    return e;
  };
  const drawables = [];
  root.traverse((o) => { if (o.isMesh || o.isLine) drawables.push(o); });
  const old = new Set();
  // draw order among see-through layers: xray first, then a fading cover blends over it (outlines 1, shadows 2)
  const ORDER = { base: 0, xray: 0.5, cover: 1.5 };
  for (const o of drawables) {
    const node = nodeOf(o);
    if (!node) continue;
    const e = nodeEntry(node);
    const depthPull = e.layer === 'xray' ? xrayPull : 0;
    o.renderOrder = ORDER[e.layer] || 0;
    const g = o.geometry;
    growBounds(g);
    for (const m of [].concat(o.material)) old.add(m);
    if (o.isLineSegments || o.isLine) {
      const lm = createLineMaterial({ geometry: g, uniforms, look, depthPull });
      o.material = lm;
      if (opts.lines === 'fat' && o.isLineSegments) {
        const fat = createFatLines(o, { uniforms, look, depthPull });
        fat.userData.inkScale = opts.inkScale;
        fat.renderOrder = o.renderOrder;
        o.add(fat);
        lm.visible = false;                    // the GL line stays as the fat line's frame, undrawn
        e.lines.push(fat); e.materials.push(fat.material);
      } else { e.lines.push(o); e.materials.push(lm); }
      continue;
    }
    const shade = shadeOf(o.material) || (g.attributes._ink_mid ? 'fixed' : 'flat');
    const m = createInkMaterial({ shade: shade === 'line' ? 'flat' : shade, look, geometry: g, uniforms, depthPull });
    o.material = m;
    o.userData.shade = shade;
    e.bodies.push(o); e.materials.push(m);
    if (shade === 'sun' || shade === 'fixed') e.solids.push(o);
  }
  for (const m of old) m.dispose();

  // channels, and the transforms of the nodes they move
  const chans = new Map();
  const nodeMotion = new Map();   // node -> { rest, explode, motions: [state] }
  const partOfNode = new Map();
  for (const p of parts) for (const n of p.nodes || []) partOfNode.set(n, p);
  const motionOf = (node, ch) => {
    let s = nodeMotion.get(node);
    if (!s) {
      const part = partOfNode.get(nameOf(node)) || (ch && partsById.get(ch.part));
      s = { node, rest: { position: node.position.clone(), quaternion: node.quaternion.clone() }, explode: vec(part && part.explode), motions: [] };
      nodeMotion.set(node, s);
    }
    return s;
  };
  for (const ch of sidecar.channels || []) {
    const ns = (ch.nodes || []).map((n) => byName.get(n)).filter(Boolean);
    const st = { ch, nodes: ns, value: ch.value ? ch.value.rest : 0, angle: null, offset: null, rpm: 0, axis: vec(ch.axis, [0, 1, 0]).normalize(), pivot: ch.pivot ? vec(ch.pivot) : null, materials: [] };
    if (ch.kind === 'emissive') {
      for (const n of ns) n.traverse((o) => { if (o.material && o.material.userData && o.material.userData.inkRole === 'body') st.materials.push(o.material); });
    } else {
      if (ch.kind === 'rotate' || ch.kind === 'spin') st.angle = 0;
      if (ch.kind === 'translate') st.offset = new THREE.Vector3();
      for (const n of ns) motionOf(n, ch).motions.push(st);
    }
    chans.set(ch.id, st);
  }
  // every channel node moves with its part's explode, lit or not
  for (const e of nodes.values()) if (!STATIC_NODES.includes(e.name)) motionOf(e.node, (sidecar.channels || []).find((c) => (c.nodes || []).includes(e.name)));

  // silhouettes and shadows
  object.updateMatrixWorld(true);
  const sizeOf = (meshes) => {
    const box = new THREE.Box3();
    for (const o of meshes) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); }
    return box.isEmpty() ? 0 : box.getSize(new THREE.Vector3()).length();
  };
  const itemSize = sizeOf([...nodes.values()].flatMap((e) => e.bodies));
  for (const e of nodes.values()) {
    if (!e.bodies.length || e.layer === 'xray') continue;
    // a channel node casts when it turns, or when it is a big share of the item (an LED part's lit dome),
    // so a board's tiny LEDs and buttons cost no extra draw call
    const big = !STATIC_NODES.includes(e.name) && sizeOf(e.bodies) >= 0.25 * itemSize;
    const moving = big || (nodeMotion.get(e.node) && nodeMotion.get(e.node).motions.some((s) => s.angle != null));
    const isStatic = STATIC_NODES.includes(e.name);
    if (e.solids.length && (opts.outlines === true || (opts.outlines === 'static' && isStatic))) {
      for (const o of e.solids) addOutlineWeights(o.geometry, weights);
      const out = createOutline(e.solids.length === 1 ? e.solids[0] : e.solids, { uniforms, look, faces: opts.hull });
      out.userData.inkScale = opts.inkScale;
      e.outlines.push(out);
    }
    // every triangle casts, flat fills too: a PCB's top is an ink.flat fill over its side walls
    const wantShadow = opts.shadows && (isStatic || opts.channelShadows === 'all' || (opts.channelShadows === 'moving' && moving));
    if (wantShadow) e.shadows.push(createShadow(e.bodies.length === 1 ? e.bodies[0] : e.bodies, { look, root, planeY: opts.planeY, uniforms }));
  }

  // optional printed text
  let texts = null;
  if (opts.texts) { texts = createTextMeshes(sidecar, { uniforms }); if (texts) root.add(texts); }

  /* ---------- state ---------- */
  let explodeT = 0, seeT = 0, highlighted = null, lastFrame = -1, disposed = false;
  const hiddenParts = new Set();
  const applyNode = (s) => {
    const motions = s.motions.map((m) => ({ axis: m.axis, pivot: m.pivot, angle: m.angle, offset: m.offset }));
    const pose = nodePose(s.rest, s.explode, explodeT, motions);
    s.node.position.copy(pose.position);
    s.node.quaternion.copy(pose.quaternion);
  };
  const applyAll = () => { for (const s of nodeMotion.values()) applyNode(s); };
  const sync = (renderer) => {
    const f = renderer && renderer.info ? renderer.info.render.frame : -2;
    if (f === lastFrame) return;
    lastFrame = f;
    updateInkLights(uniforms, look, root);
  };
  for (const e of nodes.values()) for (const o of e.bodies) o.onBeforeRender = sync;
  const applyVisibility = () => {
    const partHidden = (name) => { const p = partOfNode.get(name); return p ? isHidden(p.id) : false; };
    for (const e of nodes.values()) e.node.visible = e.layerVisible && !partHidden(e.name);
  };
  const isHidden = (id) => hiddenParts.has(id);

  const api = {
    object, root, sidecar, uniforms,
    get explodeValue() { return explodeT; },
    get seeThroughValue() { return seeT; },
    /** the object for a glTF node name ('static', 'led:L') */
    node: (name) => byName.get(name) || null,
    channel: (id) => (chans.get(id) || {}).ch || null,
    /** set a channel: emissive level 0..1 or [r, g, b]; rotate deg; translate press 0..1; spin rpm. false if unknown */
    set(id, value) {
      const s = chans.get(id);
      if (!s) return false;
      const ch = s.ch;
      if (ch.kind === 'emissive') {
        const { color, level } = emissiveOf(ch, value);
        s.value = value;
        for (const m of s.materials) setInkEmissive(m, color, level);
        return true;
      }
      if (ch.kind === 'spin') { s.value = s.rpm = clampValue(ch, value); return true; }
      s.value = clampValue(ch, value);
      if (ch.kind === 'rotate') s.angle = rotateAngle(ch, s.value);
      if (ch.kind === 'translate') s.offset = translateOffset(ch, s.value);
      for (const n of s.nodes) { const m = nodeMotion.get(n); if (m) applyNode(m); }
      return true;
    },
    get(id) { const s = chans.get(id); return s ? s.value : undefined; },
    /** advance spin channels by dt seconds */
    update(dt = 0) {
      for (const s of chans.values()) {
        if (s.ch.kind !== 'spin' || !s.rpm) continue;
        s.angle = (s.angle + spinRate(s.ch, s.rpm) * dt) % (2 * Math.PI);
        for (const n of s.nodes) { const m = nodeMotion.get(n); if (m) applyNode(m); }
      }
      root.updateWorldMatrix(true, false);
      updateInkLights(uniforms, look, root);
      return api;
    },
    explode(t) {
      explodeT = clamp01(Number(t) || 0);
      uniforms.uExplode.value = explodeT;
      applyAll();
      return api;
    },
    seeThrough(t) {
      seeT = clamp01(Number(t) || 0);
      for (const e of nodes.values()) {
        const l = (sidecar.layers || []).find((x) => x.id === e.layer);
        const op = l ? lerp(l.opacity[0], l.opacity[1], seeT) : e.layer === 'xray' ? seeT : e.layer === 'cover' ? lerp(1, 0.28, seeT) : 1;
        for (const m of e.materials) setInkOpacity(m, op);
        e.layerVisible = op > 0.003;
        const oo = smoothstep(0.55, 1, op);          // a hull seen through a translucent body would read as a blot
        for (const o of e.outlines) { setInkOpacity(o.material, oo); o.visible = oo > 0.003; }
        for (const s of e.shadows) s.visible = op >= 0.25;
      }
      applyVisibility();
      return api;
    },
    /** an anchor with its position and normal in world space, honouring explode, its channel's motion and the
        item's world transform; null when unknown */
    anchor(id) {
      const a = anchors.get(id);
      if (!a) return null;
      const p = vec(a.position), n = vec(a.normal, [0, 1, 0]), up = a.up ? vec(a.up) : null;
      const st = a.channel ? chans.get(a.channel) : null;
      const node = st && st.nodes[0];
      const motion = node && nodeMotion.get(node);
      if (motion) {
        const restM = new THREE.Matrix4().compose(motion.rest.position, motion.rest.quaternion, new THREE.Vector3(1, 1, 1));
        const nowM = new THREE.Matrix4().compose(node.position, node.quaternion, new THREE.Vector3(1, 1, 1));
        const delta = nowM.multiply(restM.invert());
        p.applyMatrix4(delta); n.transformDirection(delta); if (up) up.transformDirection(delta);
      } else {
        const part = partsById.get(a.part);
        if (part) p.addScaledVector(vec(part.explode), explodeT);
      }
      root.updateWorldMatrix(true, false);
      p.applyMatrix4(root.matrixWorld); n.transformDirection(root.matrixWorld); if (up) up.transformDirection(root.matrixWorld);
      const out = { ...a, position: p, normal: n };
      if (up) out.up = up;
      return out;
    },
    /** tint one part (by id) with the accent colour; null clears */
    highlight(partId) {
      const p = partId != null ? partsById.get(partId) : null;
      highlighted = p ? p.id : null;
      uniforms.uHighlight.value = p ? p.index : -1;
      return api;
    },
    get highlighted() { return highlighted; },
    /** show or hide a part and every part under it (geometry, silhouette, shadow, its channel nodes) */
    setPartVisible(partId, visible) {
      const ids = [partId], seen = new Set();
      while (ids.length) {
        const id = ids.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        for (const p of parts) if (p.parent === id && p.id !== id) ids.push(p.id);
      }
      for (const id of seen) {
        const p = partsById.get(id);
        if (!p) continue;
        if (visible) hiddenParts.delete(id); else hiddenParts.add(id);
        if (p.index >= 0 && p.index < 512) {
          const w = p.index >> 5, b = 1 << (p.index & 31);
          uniforms.uHidden.value[w] = visible ? (uniforms.uHidden.value[w] & ~b) >>> 0 : (uniforms.uHidden.value[w] | b) >>> 0;
        }
      }
      applyVisibility();
      return api;
    },
    isPartVisible: (id) => !hiddenParts.has(id),
    /** multiplies every ink width (silhouettes, fat lines) */
    setInkScale(s) { opts.inkScale = s; object.traverse((o) => { if (o.userData.inkRole === 'outline' || o.userData.inkRole === 'line') o.userData.inkScale = s; }); return api; },
    /** draw calls this item issues per eye now (body + line + outline + shadow) */
    drawCalls() {
      let n = 0;
      object.traverseVisible((o) => { if ((o.isMesh || o.isLine) && o.material && o.material.visible !== false) n++; });
      return n;
    },
    texts,
    dispose() {
      if (disposed) return;
      disposed = true;
      const geos = new Set(), mats = new Set();
      object.traverse((o) => { if (o.geometry) geos.add(o.geometry); if (o.material) [].concat(o.material).forEach((m) => mats.add(m)); });
      for (const g of geos) g.dispose();
      for (const m of mats) { if (m.uniforms && m.uniforms.map && m.uniforms.map.value) m.uniforms.map.value.dispose(); m.dispose(); }
      if (object.parent) object.parent.remove(object);
    },
  };
  // the channels' rest values
  for (const s of chans.values()) if (s.ch.value && s.ch.kind !== 'spin') api.set(s.ch.id, s.ch.value.rest);
  api.explode(0);
  api.seeThrough(0);
  object.updateMatrixWorld(true);
  updateInkLights(uniforms, look, root);
  object.userData.xrAsset = api;
  return api;
}

/** exploded vertices travel up to |_explode|: grow the bounds so frustum culling never drops them */
function growBounds(g) {
  if (!g.boundingSphere) g.computeBoundingSphere();
  const e = g.attributes._explode;
  if (!e || !g.boundingSphere) return;
  let m = 0;
  for (let i = 0; i < e.count; i++) m = Math.max(m, Math.hypot(e.getX(i), e.getY(i), e.getZ(i)));
  g.boundingSphere.radius += m;
}
/** _outline_w: each vertex's silhouette weight from its part (ink units) */
function addOutlineWeights(g, weights) {
  if (g.attributes._outline_w) return;
  const part = g.attributes._part, n = g.attributes.position.count, w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = part ? (weights.get(Math.round(part.getX(i))) || 1.4) : HULL_MAX;
  g.setAttribute('_outline_w', new THREE.BufferAttribute(w, 1));
}

/* ---------- printed text (optional; textures for text only) ---------- */
const TEXT_VERT = /* glsl */`
uniform float uExplode;
uniform uint uHidden[16];
attribute vec3 _explode;
attribute float _part;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position + uExplode * _explode, 1.0);
  gl_Position = projectionMatrix * mv;
  uint p = uint(max(_part, 0.0) + 0.5);
  if (_part >= 0.0 && p < 512u && ((uHidden[p >> 5u] >> (p & 31u)) & 1u) != 0u) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const TEXT_FRAG = /* glsl */`
uniform sampler2D map;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.35) discard;
  gl_FragColor = vec4(c.rgb, c.a * uOpacity);
  #include <colorspace_fragment>
}`;
/**
 * sidecar.texts as one mesh: every text rasterised once into a single canvas atlas, one quad each on its surface
 * (reading direction cross(up, normal), so it is never mirrored), moving with its part's explode. One draw call.
 * Returns null where there is no canvas (Node). Text in the xray layer is left out.
 */
export function createTextMeshes(sidecar, { uniforms = null, px = 48 } = {}) {
  const list = (sidecar.texts || []).filter((t) => t.text && t.layer !== 'xray');
  if (!list.length) return null;
  const mk = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : null);
  const probe = mk(8, 8);
  const g0 = probe && probe.getContext && probe.getContext('2d');
  if (!g0) return null;
  const font = (t) => `${t.weight || 700} ${px}px ui-monospace, Menlo, monospace`;
  const cellH = Math.ceil(px * 1.3), pad = 4;
  const widths = list.map((t) => { g0.font = font(t); return Math.ceil(g0.measureText(t.text).width) + 2 * pad; });
  const W = 2048;
  let x = 0, y = 0;
  const cells = widths.map((w) => { if (x + w > W) { x = 0; y += cellH; } const c = { x, y, w }; x += w; return c; });
  const H = THREE.MathUtils.ceilPowerOfTwo(Math.max(cellH, y + cellH));
  const canvas = mk(W, H), g = canvas.getContext('2d');
  g.textBaseline = 'alphabetic'; g.textAlign = 'center';
  list.forEach((t, i) => { g.font = font(t); g.fillStyle = t.color || INK; g.fillText(t.text, cells[i].x + cells[i].w / 2, cells[i].y + px); });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const parts = new Map((sidecar.parts || []).map((p) => [p.id, p]));
  const P = [], UV = [], X = [], PT = [], I = [];
  const capPx = px * 0.72;
  list.forEach((t, i) => {
    const s = t.size / capPx, c = cells[i];
    const n = vec(t.normal, [0, 1, 0]).normalize(), up = vec(t.up, [0, 0, -1]).normalize(), r = new THREE.Vector3().crossVectors(up, n).normalize();
    const o = vec(t.position).addScaledVector(n, 0.00005);
    const left = -c.w / 2 * s, right = c.w / 2 * s, bot = -(cellH - px) * s, top = px * s;
    const corner = (u, v) => o.clone().addScaledVector(r, u).addScaledVector(up, v);
    const q = [corner(left, bot), corner(right, bot), corner(right, top), corner(left, top)];
    const base = P.length / 3;
    for (const p of q) P.push(p.x, p.y, p.z);
    UV.push(c.x / W, 1 - (c.y + cellH) / H, (c.x + c.w) / W, 1 - (c.y + cellH) / H, (c.x + c.w) / W, 1 - c.y / H, c.x / W, 1 - c.y / H);
    const part = parts.get(t.part), e = part ? part.explode : [0, 0, 0];
    for (let k = 0; k < 4; k++) { X.push(...e); PT.push(part ? part.index : -1); }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  geo.setAttribute('_explode', new THREE.Float32BufferAttribute(X, 3));
  geo.setAttribute('_part', new THREE.Float32BufferAttribute(PT, 1));
  geo.setIndex(I);
  const u = uniforms || createInkUniforms(sidecar.look);
  const mat = new THREE.ShaderMaterial({
    name: 'ink.text', uniforms: { uExplode: u.uExplode, uHidden: u.uHidden, map: { value: tex }, uOpacity: { value: 1 } },
    vertexShader: withLogDepthVertex(TEXT_VERT), fragmentShader: withLogDepthFragment(TEXT_FRAG), side: THREE.DoubleSide, transparent: false,
  });
  mat.toneMapped = false;
  mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -6;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'texts';
  mesh.userData.inkRole = 'text';
  return mesh;
}
