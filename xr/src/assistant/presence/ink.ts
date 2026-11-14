/**
 * Inked solids for the companion, in the look kit's terms: three flat bands per face against the fixed light
 * (`look/light.ts` FIXED_LIGHT, `look/palette.ts` bandsOf), an ink silhouette as an inverted hull, unlit. Small and
 * local because the kit has no shared ink-solid builder yet; switch to it when it has one.
 */
import { BackSide, BufferAttribute, BufferGeometry, Color, MeshBasicMaterial } from '@iwsdk/core';
import { FIXED_LIGHT } from '../../look/light';
import { bandsOf, hexNum, INK } from '../../look/palette';

/** Which band a face with this normal takes under the fixed light (the run kit's thresholds). */
export function bandOf(nx: number, ny: number, nz: number): 'l' | 'm' | 'd' {
  const dot = nx * FIXED_LIGHT[0] + ny * FIXED_LIGHT[1] + nz * FIXED_LIGHT[2];
  return dot > 0.6 ? 'l' : dot < 0.05 ? 'd' : 'm';
}

/** Writes `hex`'s three bands into the vertex colours of a non-indexed geometry, by each vertex's normal. */
export function paintBands(geometry: BufferGeometry, hex: string): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const n = g.getAttribute('normal');
  const bands = bandsOf(hex);
  const out = new Float32Array(n.count * 3);
  const c = new Color();
  for (let i = 0; i < n.count; i++) {
    c.set(bands[bandOf(n.getX(i), n.getY(i), n.getZ(i))]);
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(out, 3));
  return g;
}

/** One flat colour in the vertex colours (eyes, the nib's ink). */
export function paintFlat(geometry: BufferGeometry, hex: string): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const count = g.getAttribute('position').count;
  const out = new Float32Array(count * 3);
  const c = new Color(hex);
  for (let i = 0; i < count; i++) {
    out[i * 3] = c.r;
    out[i * 3 + 1] = c.g;
    out[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(out, 3));
  return g;
}

/** Joins non-indexed geometries with position, normal and colour into one, so the figure is one draw. */
export function merge(parts: readonly BufferGeometry[]): BufferGeometry {
  const names = ['position', 'normal', 'color'] as const;
  const out = new BufferGeometry();
  for (const name of names) {
    const total = parts.reduce((s, p) => s + p.getAttribute(name).count * 3, 0);
    const arr = new Float32Array(total);
    let at = 0;
    for (const p of parts) {
      const a = p.getAttribute(name);
      for (let i = 0; i < a.count; i++) {
        arr[at++] = a.getX(i);
        arr[at++] = a.getY(i);
        arr[at++] = a.getZ(i);
      }
    }
    out.setAttribute(name, new BufferAttribute(arr, 3));
  }
  return out;
}

/** A copy pushed out `width` along the normal averaged over coincident vertices: the silhouette shell. */
export function hullOf(geometry: BufferGeometry, width: number): BufferGeometry {
  const src = new BufferGeometry();
  src.setAttribute('position', geometry.getAttribute('position').clone());
  src.setAttribute('normal', geometry.getAttribute('normal').clone());
  const p = src.getAttribute('position');
  const n = src.getAttribute('normal');
  const key = (i: number) => `${Math.round(p.getX(i) * 1e5)},${Math.round(p.getY(i) * 1e5)},${Math.round(p.getZ(i) * 1e5)}`;
  const sums = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const k = key(i);
    const s = sums.get(k) ?? [0, 0, 0];
    s[0] += n.getX(i);
    s[1] += n.getY(i);
    s[2] += n.getZ(i);
    sums.set(k, s);
  }
  const moved = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const s = sums.get(key(i))!;
    const len = Math.hypot(s[0], s[1], s[2]) || 1;
    moved[i * 3] = p.getX(i) + (s[0] / len) * width;
    moved[i * 3 + 1] = p.getY(i) + (s[1] / len) * width;
    moved[i * 3 + 2] = p.getZ(i) + (s[2] / len) * width;
  }
  src.setAttribute('position', new BufferAttribute(moved, 3));
  return src;
}

/** The banded body's material: colours in the vertices, unlit, fadeable. */
export const bodyMaterial = (): MeshBasicMaterial => new MeshBasicMaterial({ vertexColors: true, transparent: true, toneMapped: false });

/** The silhouette's material: ink on the back faces. */
export const outlineMaterial = (): MeshBasicMaterial =>
  new MeshBasicMaterial({ color: hexNum(INK), side: BackSide, transparent: true, toneMapped: false });
