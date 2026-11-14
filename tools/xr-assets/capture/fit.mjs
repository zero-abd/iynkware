// Rigid fits between two captures of the same pieces (rest and moved): the rotation and translation that carry one
// point set onto the other (Horn's quaternion method), and the rotation's axis and pivot.
import { add, cross, dot, len, norm, scale, sub } from '../gltf/geom.mjs';

const mean = (ps) => { const s = [0, 0, 0]; for (const p of ps) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return scale(s, 1 / ps.length); };

function largestEigen4(N) {
  let shift = 0;
  for (const row of N) for (const v of row) shift += Math.abs(v);
  let v = [1, 0.1, 0.1, 0.1];
  for (let it = 0; it < 500; it++) {
    const w = [0, 1, 2, 3].map((i) => N[i][0] * v[0] + N[i][1] * v[1] + N[i][2] * v[2] + N[i][3] * v[3] + shift * v[i]);
    const l = Math.hypot(...w) || 1;
    const nv = w.map((x) => x / l);
    const d = Math.hypot(nv[0] - v[0], nv[1] - v[1], nv[2] - v[2], nv[3] - v[3]);
    v = nv;
    if (d < 1e-13) break;
  }
  return v;
}

export const rotate = (q, p) => {   // q = [w, x, y, z]
  const [w, x, y, z] = q, u = [x, y, z], t = scale(cross(u, p), 2);
  return add(add(p, scale(t, w)), cross(u, t));
};

/** Best rotation q and translation t with b ~ rotate(q, a) + t. Returns { q, t, rms }. */
export function fitRigid(A, B) {
  const ca = mean(A), cb = mean(B);
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < A.length; i++) {
    const a = sub(A[i], ca), b = sub(B[i], cb);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += a[r] * b[c];
  }
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  let q = largestEigen4(N);
  if (q[0] < 0) q = q.map((v) => -v);
  const t = sub(cb, rotate(q, ca));
  let e = 0;
  for (let i = 0; i < A.length; i++) { const d = sub(add(rotate(q, A[i]), t), B[i]); e += dot(d, d); }
  return { q, t, rms: Math.sqrt(e / A.length) };
}

/** Axis (unit), angle (rad, right-hand about axis) and the pivot nearest `near` for a fitted rigid motion. */
export function axisAngle({ q, t }, near) {
  const s = Math.hypot(q[1], q[2], q[3]);
  if (s < 1e-9) return { axis: [0, 1, 0], angle: 0, pivot: near };
  const axis = [q[1] / s, q[2] / s, q[3] / s], angle = 2 * Math.atan2(s, q[0]);
  // pivot c on the axis: (I - R) c = t, solved in the plane normal to the axis, then moved along it to `near`
  const e1 = norm(cross(Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], axis)), e2 = cross(axis, e1);
  const R = (v) => rotate(q, v);
  const a11 = dot(sub(e1, R(e1)), e1), a12 = dot(sub(e2, R(e2)), e1), a21 = dot(sub(e1, R(e1)), e2), a22 = dot(sub(e2, R(e2)), e2);
  const b1 = dot(t, e1), b2 = dot(t, e2), det = a11 * a22 - a12 * a21;
  if (Math.abs(det) < 1e-12) return { axis, angle, pivot: near };
  const u = (b1 * a22 - a12 * b2) / det, v = (a11 * b2 - a21 * b1) / det;
  const c = add(scale(e1, u), scale(e2, v));
  return { axis, angle, pivot: add(c, scale(axis, dot(sub(near, c), axis))) };
}

export const distance = (a, b) => len(sub(a, b));
