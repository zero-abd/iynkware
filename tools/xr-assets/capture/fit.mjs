// Rigid fits between two captures of the same pieces (rest and moved): the rotation and translation that carry one
// point set onto the other (Horn's quaternion method, with a cyclic Jacobi eigensolver: power iteration stalls on thin
// point sets such as a two-blade prop, where the two largest eigenvalues nearly meet), and the rotation's axis and pivot.
import { add, cross, dot, len, norm, scale, sub } from '../gltf/geom.mjs';

const mean = (ps) => { const s = [0, 0, 0]; for (const p of ps) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return scale(s, 1 / ps.length); };

/** Eigenvector of the largest eigenvalue of a symmetric 4x4 (cyclic Jacobi). */
function topEigen4(N) {
  const a = N.map((r) => r.slice()), v = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-30) break;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < 4; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < 4; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i;
  return [v[0][best], v[1][best], v[2][best], v[3][best]];
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
  let q = topEigen4(N);
  const l = Math.hypot(...q) || 1;
  q = q.map((x) => x / l);
  if (q[0] < 0) q = q.map((x) => -x);
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
