// Coplanar faces (issue #132). The 2D figures paint in order, so a face drawn over another in the same plane (a wheel's
// spoke gaps on its hub disc, a label on a panel) simply wins there. In 3D the two share every depth value and z-fight:
// the result reads as hatching. Here each face that overlaps an earlier face in the same plane, facing the same way,
// is lifted along its normal by one step per face it sits on, so the depth buffer keeps the figure's paint order.
import { dot, cross, norm } from './geom.mjs';

/** Lift per layer, metres (0.1 mm: clear of 16-bit depth at arm's length, invisible at any work scale). */
export const LAYER_STEP = 0.0001;
/** Faces whose planes are within this distance (metres) and whose normals agree count as one plane. */
export const PLANE_TOL = 0.00005;
/** No face is lifted more than this many layers. */
export const MAX_LAYERS = 4;
/** Overlaps thinner than this (metres) are touching edges, not overlaps. */
const TOUCH = 1e-6;

/**
 * The layer of each face, in draw order: 0 for a face that sits on no earlier coplanar face, else one more than the
 * highest layer of the earlier coplanar faces it overlaps (capped at MAX_LAYERS). `faces` are { v: [[x,y,z]...], n }.
 */
export function coplanarLayers(faces) {
  const layers = new Array(faces.length).fill(0);
  // bucket by normal direction, then by plane offset
  const buckets = new Map();
  faces.forEach((f, i) => {
    const n = f.n;
    if (!n || f.v.length < 3 || !(n[0] || n[1] || n[2])) return;
    const d = dot(n, f.v[0]);
    if (f.v.some((p) => Math.abs(dot(n, p) - d) > PLANE_TOL)) return;   // not planar enough to share a plane
    const key = n.map((c) => Math.round(c * 500)).join(',');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ i, d });
  });
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.d - b.d);
    let start = 0;
    for (let k = 1; k <= list.length; k++) {
      if (k < list.length && list[k].d - list[k - 1].d <= PLANE_TOL) continue;
      if (k - start >= 2) layerCluster(faces, list.slice(start, k).map((e) => e.i).sort((a, b) => a - b), layers);
      start = k;
    }
  }
  return layers;
}

function layerCluster(faces, idx, layers) {
  const n = norm(faces[idx[0]].n);
  const t1 = norm(cross(Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], n)), t2 = cross(n, t1);
  const flat = idx.map((i) => {
    const p = faces[i].v.map((q) => [dot(q, t1), dot(q, t2)]);
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of p) { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); }
    return { i, p, box, tris: null };
  });
  for (let b = 1; b < flat.length; b++) {
    const B = flat[b];
    let layer = 0;
    for (let a = 0; a < b; a++) {
      const A = flat[a];
      if (layers[A.i] + 1 <= layer) continue;
      if (A.box[0] > B.box[2] - TOUCH || B.box[0] > A.box[2] - TOUCH || A.box[1] > B.box[3] - TOUCH || B.box[1] > A.box[3] - TOUCH) continue;
      if (polygonsOverlap(A, B)) layer = Math.min(MAX_LAYERS, layers[A.i] + 1);
    }
    layers[B.i] = layer;
  }
}

/** Whether two planar polygons (2D, any winding, possibly concave) share an area wider than TOUCH. */
function polygonsOverlap(A, B) {
  const ta = A.tris || (A.tris = trianglesOf(A.p)), tb = B.tris || (B.tris = trianglesOf(B.p));
  for (const s of ta) for (const t of tb) if (trianglesOverlap(s, t)) return true;
  return false;
}

/** Ear clipping in 2D (the polygons are simple; a degenerate rest is fanned). */
function trianglesOf(p) {
  const k = p.length;
  let area = 0;
  for (let i = 0; i < k; i++) { const a = p[i], b = p[(i + 1) % k]; area += a[0] * b[1] - b[0] * a[1]; }
  const idx = [...Array(k).keys()];
  if (area < 0) idx.reverse();
  const cr = (a, b, c) => (p[b][0] - p[a][0]) * (p[c][1] - p[a][1]) - (p[b][1] - p[a][1]) * (p[c][0] - p[a][0]);
  const eps = 1e-12 * (Math.abs(area) + 1e-12);
  // a vertex on an ear's edge blocks it too (an L's reflex corner on the diagonal), unless it is one of its corners
  const same = (q, r) => p[q][0] === p[r][0] && p[q][1] === p[r][1];
  const inside = (q, a, b, c) => !same(q, a) && !same(q, b) && !same(q, c) && cr(a, b, q) >= -eps && cr(b, c, q) >= -eps && cr(c, a, q) >= -eps;
  const out = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 20000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (cr(a, b, c) <= eps) continue;
      if (idx.some((q) => q !== a && q !== b && q !== c && inside(q, a, b, c))) continue;
      out.push([p[a], p[b], p[c]]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx.map((i) => p[i]));
  else for (let i = 1; i < idx.length - 1; i++) out.push([p[idx[0]], p[idx[i]], p[idx[i + 1]]]);
  return out.filter(([a, b, c]) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1e-14);
}

/** Separating axis test: the triangles overlap when no edge normal separates them by more than -TOUCH. */
function trianglesOverlap(s, t) {
  for (const tri of [s, t]) {
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const ax = [b[1] - a[1], a[0] - b[0]], l = Math.hypot(ax[0], ax[1]);
      if (l < 1e-12) continue;
      ax[0] /= l; ax[1] /= l;
      let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
      for (const q of s) { const v = q[0] * ax[0] + q[1] * ax[1]; s0 = Math.min(s0, v); s1 = Math.max(s1, v); }
      for (const q of t) { const v = q[0] * ax[0] + q[1] * ax[1]; t0 = Math.min(t0, v); t1 = Math.max(t1, v); }
      if (Math.min(s1, t1) - Math.max(s0, t0) <= TOUCH) return false;
    }
  }
  return true;
}
