// Geometry builders: one captured draw (a recorded primitive, a pd() path, a text) becomes faces and lines in the
// figure's world (Colorfigures coordinates, mm). A face is a planar polygon with an outward normal and a material
// { l, m, d } with a shading class; a line is a polyline with a colour and the figure's stroke width.
// The solids are closed (the 2D core draws only the faces it can see; here every face is built).
export const INK = '#231e16';

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const avg = (ps) => { const s = [0, 0, 0]; for (const p of ps) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return scale(s, 1 / (ps.length || 1)); };

const HEX = /^#[0-9a-f]{6}$/i;
const mixHex = (a, b, t) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.substr(i, 2), 16) * (1 - t) + parseInt(b.substr(i, 2), 16) * t).toString(16).padStart(2, '0')).join('');
export const matOf = (hex) => ({ l: hex, m: mixHex(hex, '#000000', 0.16), d: mixHex(hex, '#000000', 0.42) });
export const flatMat = (hex) => ({ l: hex, m: hex, d: hex });
const lower = (m) => m && { l: m.l.toLowerCase(), m: (m.m || m.l).toLowerCase(), d: (m.d || m.l).toLowerCase() };

/** Newell normal of a polygon (unit; zero vector for a degenerate one). */
export function newell(v) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    x += (a[1] - b[1]) * (a[2] + b[2]); y += (a[2] - b[2]) * (a[0] + b[0]); z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(x, y, z);
  return l < 1e-12 ? [0, 0, 0] : [x / l, y / l, z / l];
}

/** Ear-clipping triangulation of a planar polygon; returns index triples wound counter-clockwise about n. */
export function triangulate(v, n) {
  const k = v.length;
  if (k < 3) return [];
  // a basis (t1, t2) of the plane with t1 x t2 = n: counter-clockwise in (t1, t2) is counter-clockwise about n
  const t1 = norm(cross(Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], n)), t2 = cross(n, t1);
  const p = v.map((q) => [dot(q, t1), dot(q, t2)]);
  let area = 0;
  for (let i = 0; i < k; i++) { const a = p[i], b = p[(i + 1) % k]; area += a[0] * b[1] - b[0] * a[1]; }
  const idx = [...Array(k).keys()];
  if (area < 0) idx.reverse();
  const tris = [];
  const cr = (a, b, c) => (p[b][0] - p[a][0]) * (p[c][1] - p[a][1]) - (p[b][1] - p[a][1]) * (p[c][0] - p[a][0]);
  const eps = 1e-9 * (Math.abs(area) + 1e-9);
  const inside = (q, a, b, c) => cr(a, b, q) > eps && cr(b, c, q) > eps && cr(c, a, q) > eps;
  let guard = 0;
  while (idx.length > 3 && guard++ < 20000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
      if (cr(a, b, c) <= eps) continue;
      let ok = true;
      for (const q of idx) if (q !== a && q !== b && q !== c && inside(q, a, b, c)) { ok = false; break; }
      if (!ok) continue;
      tris.push([a, b, c]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;                                      // degenerate or self-intersecting: fan the rest
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  else for (let i = 1; i < idx.length - 1; i++) tris.push([idx[0], idx[i], idx[i + 1]]);
  return tris;
}

const ring = (c, u, v, r, n) => Array.from({ length: n }, (_, i) => { const t = i / n * 2 * Math.PI, a = Math.cos(t) * r, b = Math.sin(t) * r;
  return [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b, c[2] + u[2] * a + v[2] * b]; });

/** Two rings joined by quads, outward from the centroid, with caps where asked. */
function prism(A, B, mat, cls, { capA = true, capB = true } = {}) {
  const faces = [], cen = avg([...A, ...B]), n = A.length;
  for (let i = 0; i < n; i++) {
    const q = [A[i], A[(i + 1) % n], B[(i + 1) % n], B[i]];
    let nr = newell(q);
    if (!nr[0] && !nr[1] && !nr[2]) continue;
    if (dot(nr, sub(avg(q), cen)) < 0) nr = scale(nr, -1);
    faces.push({ v: q, n: nr, mat, cls });
  }
  for (const [R, on] of [[A, capA], [B, capB]]) {
    if (!on || R.length < 3) continue;
    let nr = newell(R);
    if (!nr[0] && !nr[1] && !nr[2]) continue;
    if (dot(nr, sub(avg(R), cen)) < 0) nr = scale(nr, -1);
    faces.push({ v: R, n: nr, mat, cls, cap: true });
  }
  return faces;
}

const loop = (pts, col, w) => ({ pts: [...pts, pts[0]], col, w });

/** Material and class for a fill colour: what tone/toneI said made it, else a flat colour. */
export function shadeOf(c, shades) {
  if (typeof c !== 'string' || !HEX.test(c)) return null;
  const s = shades.get(c) || shades.get(c.toLowerCase());
  if (s && s.m) return { mat: lower(s.m), cls: s.cls, hint: s.n };
  return { mat: flatMat(c.toLowerCase()), cls: 'flat', hint: null };
}

/** Orient a polygon's normal: towards the hint when they are parallel, else towards the default viewer. */
function orient(v, hint) {
  let n = newell(v);
  if (!n[0] && !n[1] && !n[2]) return null;
  if (hint && Math.abs(dot(n, hint)) > 0.7) { if (dot(n, hint) < 0) n = scale(n, -1); }
  else if (n[0] + n[1] + n[2] < 0) n = scale(n, -1);     // the figure's viewer sits at (+1, +1, +1)
  return n;
}

/** Faces and lines for one recorded primitive. */
export function fromPrim(p, shades) {
  const faces = [], lines = [], marks = [];
  const mat = p.m ? lower(p.m) : null, cls = p.cls || 'fixed';
  switch (p.t) {
    case 'box': {
      const [x0, y0, z0, x1, y1, z1] = p.a;
      const lo = [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], hi = [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)];
      const c = (i, j, k) => [i ? hi[0] : lo[0], j ? hi[1] : lo[1], k ? hi[2] : lo[2]];
      const F = [[[1, 0, 0], [c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)]], [[-1, 0, 0], [c(0, 0, 0), c(0, 0, 1), c(0, 1, 1), c(0, 1, 0)]],
        [[0, 1, 0], [c(0, 1, 0), c(0, 1, 1), c(1, 1, 1), c(1, 1, 0)]], [[0, -1, 0], [c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)]],
        [[0, 0, 1], [c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)]], [[0, 0, -1], [c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)]]];
      for (const [n, v] of F) faces.push({ v, n, mat, cls });
      if (p.w > 0) for (const [a, b] of [[c(0, 0, 0), c(1, 0, 0)], [c(1, 0, 0), c(1, 1, 0)], [c(1, 1, 0), c(0, 1, 0)], [c(0, 1, 0), c(0, 0, 0)],
        [c(0, 0, 1), c(1, 0, 1)], [c(1, 0, 1), c(1, 1, 1)], [c(1, 1, 1), c(0, 1, 1)], [c(0, 1, 1), c(0, 0, 1)],
        [c(0, 0, 0), c(0, 0, 1)], [c(1, 0, 0), c(1, 0, 1)], [c(1, 1, 0), c(1, 1, 1)], [c(0, 1, 0), c(0, 1, 1)]]) lines.push({ pts: [a, b], col: INK, w: p.w });
      break;
    }
    case 'cyl': {
      const [x, y, z0, z1, r] = p.a, n = p.n || 24;
      const A = ring([x, y, z0], [1, 0, 0], [0, 1, 0], r, n), B = ring([x, y, z1], [1, 0, 0], [0, 1, 0], r, n);
      faces.push(...prism(A, B, mat, cls));
      if (p.w > 0) lines.push(loop(B, INK, p.w * 0.8), loop(A, INK, p.w * 0.8));
      break;
    }
    case 'cylX': {
      const [x0, x1, y, z, r] = p.a, n = p.n || 20;
      const A = ring([x0, y, z], [0, 1, 0], [0, 0, 1], r, n), B = ring([x1, y, z], [0, 1, 0], [0, 0, 1], r, n);
      faces.push(...prism(A, B, mat, cls));
      if (p.w > 0) lines.push(loop(B, INK, p.w * 0.8), loop(A, INK, p.w * 0.8));
      break;
    }
    case 'rod': {
      const a = p.a, b = p.b, n = p.n || 16, r0 = p.r, r1 = p.r1 != null ? p.r1 : p.r;
      const d = norm(sub(b, a));
      if (!len(sub(b, a))) break;
      const u = norm(cross(d, Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), v = cross(d, u);
      const A = ring(a, u, v, r0, n), B = ring(b, u, v, r1, n);
      faces.push(...prism(A, B, mat, cls, { capA: r0 > 0, capB: r1 > 0 }));
      if (p.w > 0) { if (r1 > 0) lines.push(loop(B, INK, p.w * 0.8)); if (r0 > 0) lines.push(loop(A, INK, p.w * 0.8)); }
      break;
    }
    case 'extrude': {
      const prof = p.profile, A = prof.map(([u, v]) => [p.x0, u, v]), B = prof.map(([u, v]) => [p.x1, u, v]);
      faces.push(...prism(A, B, mat, cls).map((f) => (f.cap ? { ...f, auto: true } : f)));
      break;
    }
    case 'board': {
      const [x0, y0, x1, y1, h, r] = p.a, rr = rrUV(x0, y0, x1, y1, r);
      faces.push(...prism(rr.map(([u, v]) => [u, v, 0]), rr.map(([u, v]) => [u, v, h]), mat, 'fixed'));
      break;
    }
    case 'loft': {
      for (const s of p.strips || []) {
        const sh = s.s && s.s.c === s.c && s.s.m ? { mat: lower(s.s.m), cls: s.s.cls } : shadeOf(s.c, shades);
        if (!sh) continue;
        faces.push({ v: s.q, n: norm(s.n), mat: sh.mat, cls: sh.cls });
      }
      break;
    }
    case 'shape': {
      const sh = p.hint && p.hint.c === p.c && p.hint.m ? { mat: lower(p.hint.m), cls: p.hint.cls, hint: p.hint.n } : shadeOf(p.c, shades);
      const n = orient(p.pts, sh && sh.hint);
      if (sh && n) faces.push({ v: p.pts, n, mat: sh.mat, cls: sh.cls, authored: true });
      if (p.w > 0 && p.pts.length > 1) lines.push(loop(p.pts, INK, p.w));
      break;
    }
    case 'line':
      if (p.pts.length > 1) lines.push({ pts: p.pts, col: INK, w: p.w });
      break;
    case 'tag':
      marks.push({ kind: 'tag', at: p.p, text: p.text });
      break;
    case 'callouts':
      for (const c of p.items || []) if (Array.isArray(c.at)) marks.push({ kind: 'callout', at: c.at, text: c.text });
      break;
    default:   // 'skip': shadows and silhouette ink, which the ink material draws itself
      break;
  }
  return { faces, lines, marks };
}

function rrUV(u0, v0, u1, v1, r, n = 7) {
  if (r <= 0) return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  const arc = (cu, cv, a0, a1) => Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180; return [cu + r * Math.cos(a), cv + r * Math.sin(a)]; });
  return [...arc(u1 - r, v0 + r, -90, 0), ...arc(u1 - r, v1 - r, 0, 90), ...arc(u0 + r, v1 - r, 90, 180), ...arc(u0 + r, v0 + r, 180, 270)];
}

/** Faces and lines for a raw pd() path. */
export function fromPath(d, shades) {
  const faces = [], lines = [];
  if (d.opacity < 0.15) return { faces, lines };
  const filled = d.fill && d.fill !== 'none' && !d.fill.startsWith('url(');
  if (filled && d.pts.length >= 3) {
    const sh = shadeOf(d.fill, shades);
    const n = sh && orient(d.pts, sh.hint);
    if (sh && n) faces.push({ v: d.pts, n, mat: sh.mat, cls: sh.cls, authored: true });
  }
  const stroked = d.stroke && d.stroke !== 'none' && !d.stroke.startsWith('url(') && !(filled && d.stroke === d.fill) && !d.dash;
  if (stroked && d.pts.length > 1) {
    const col = HEX.test(d.stroke) ? d.stroke.toLowerCase() : INK;
    lines.push(d.close && d.pts.length > 2 ? loop(d.pts, col, d.sw) : { pts: d.pts, col, w: d.sw });
  }
  return { faces, lines };
}

/** A printed text: centre of its baseline, the face normal (out of the surface), up, size. Core frame. */
export function fromText(t) {
  const U = norm(t.U), V = norm(t.V), up = scale(V, -1), n = norm(cross(U, V));
  let o = t.o;
  const width = 0.62 * t.size * [...t.str].length;
  if (t.anchor === 'start') o = add(o, scale(U, width / 2));
  else if (t.anchor === 'end') o = add(o, scale(U, -width / 2));
  if (t.central) o = add(o, scale(up, -0.36 * t.size));
  return { o, n, up, size: t.size, str: t.str, col: HEX.test(t.fill) ? t.fill.toLowerCase() : INK, weight: t.weight };
}
