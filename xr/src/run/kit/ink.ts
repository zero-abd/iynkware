/**
 * Inked solids for the run pillar's own objects (the cluster, tools, cards), in the asset contract's look: three flat
 * bands picked per face against a fixed light, an ink silhouette as an inverted hull, a flat `shadow` plate on the mat.
 * Unlit (no lights, no PBR). Geometry is built once per object; nothing here runs per frame.
 *
 * Adapter: the look kit (`xr/src/look`, the Art lead) will own ink materials and outlines; switch to it when it lands.
 */
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Shape,
  ShapeGeometry,
} from '@iwsdk/core';
import { INK, bandOf, bandsOf } from './tokens';

/** One material for every inked body: the band colours live in the vertices. */
let bodyMaterial: MeshBasicMaterial | null = null;
const shadowMaterials = new Map<number, MeshBasicMaterial>();

function body(): MeshBasicMaterial {
  return (bodyMaterial ??= new MeshBasicMaterial({ vertexColors: true }));
}

/** Writes the three bands of `hex` into the vertex colours of `geometry`, by each vertex's normal. */
export function paintBands(geometry: BufferGeometry, hex: string): BufferGeometry {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const n = geometry.getAttribute('normal');
  const bands = bandsOf(hex);
  const colours = new Float32Array(n.count * 3);
  const linear = new Color();
  const v: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < n.count; i++) {
    v[0] = n.getX(i);
    v[1] = n.getY(i);
    v[2] = n.getZ(i);
    const c = bands[bandOf(v)];
    linear.setRGB(c[0], c[1], c[2], 'srgb');
    colours[i * 3] = linear.r;
    colours[i * 3 + 1] = linear.g;
    colours[i * 3 + 2] = linear.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colours, 3));
  return geometry;
}

/** A copy of `geometry` pushed out by `width` metres along the normal averaged over coincident vertices. */
export function hullOf(geometry: BufferGeometry, width: number): BufferGeometry {
  const src = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  src.deleteAttribute('color');
  src.deleteAttribute('uv');
  if (!src.getAttribute('normal')) src.computeVertexNormals();
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
  for (let i = 0; i < p.count; i++) {
    const s = sums.get(key(i))!;
    const len = Math.hypot(s[0], s[1], s[2]) || 1;
    p.setXYZ(i, p.getX(i) + (s[0] / len) * width, p.getY(i) + (s[1] / len) * width, p.getZ(i) + (s[2] / len) * width);
  }
  p.needsUpdate = true;
  return src;
}

export interface InkSolid {
  readonly group: Group;
  readonly body: Mesh;
  /** The silhouette: its own material, so hover can turn one object's outline accent. */
  readonly outline: Mesh;
  setOutline(hex: string): void;
  dispose(): void;
}

/** Outline width in metres for things in touch range (2.5 dmm at 0.47 m is about 1.2 mm). */
export const OUTLINE_M = 0.0012;

/** A banded body with its ink silhouette. Owns its geometry and its outline material. */
export function inkSolid(geometry: BufferGeometry, hex: string, opts: { outline?: number } = {}): InkSolid {
  const group = new Group();
  const b = new Mesh(paintBands(geometry, hex), body());
  const outlineMat = new MeshBasicMaterial({ color: INK.ink, side: BackSide });
  const o = new Mesh(hullOf(geometry, opts.outline ?? OUTLINE_M), outlineMat);
  b.renderOrder = 1;
  group.add(o, b);
  return {
    group,
    body: b,
    outline: o,
    setOutline(c) {
      outlineMat.color.set(c);
    },
    dispose() {
      b.geometry.dispose();
      o.geometry.dispose();
      outlineMat.dispose();
    },
  };
}

function roundedRect(w: number, d: number, r: number): Shape {
  const x = -w / 2;
  const y = -d / 2;
  const rr = Math.min(r, w / 2, d / 2);
  const s = new Shape();
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rr);
  s.lineTo(x + w, y + d - rr);
  s.quadraticCurveTo(x + w, y + d, x + w - rr, y + d);
  s.lineTo(x + rr, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - rr);
  s.lineTo(x, y + rr);
  s.quadraticCurveTo(x, y, x + rr, y);
  return s;
}

/** A slab with rounded corners, `w` along x, `d` along z, `h` up from y = 0. */
export function roundedSlab(w: number, d: number, h: number, r: number): BufferGeometry {
  const g = new ExtrudeGeometry(roundedRect(w, d, r), { depth: h, bevelEnabled: false, curveSegments: 3 });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A flat rounded rectangle facing +y at y = 0, for faces and shadows. */
export function roundedQuad(w: number, d: number, r: number): BufferGeometry {
  const g = new ShapeGeometry(roundedRect(w, d, r), 3);
  g.rotateX(-Math.PI / 2);
  // ShapeGeometry's uv is the shape's x and y in metres; make it 0..1 over the rectangle for a canvas face.
  const p = g.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / w + 0.5;
    uv[i * 2 + 1] = 0.5 - p.getZ(i) / d;
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  return g;
}

/**
 * The flat shadow of something lying on the mat: a `shadow` plate offset away from the light (section 9.1 offsets
 * panels' shadows 6 dmm right and down; on the mat it falls towards the back left of the fixed light).
 */
export function inkShadow(w: number, d: number, r: number, opacity = 1): Mesh {
  const key = Math.round(opacity * 100);
  let m = shadowMaterials.get(key);
  if (!m) {
    m = new MeshBasicMaterial({ color: INK.shadow, transparent: opacity < 1, opacity, depthWrite: false });
    shadowMaterials.set(key, m);
  }
  const mesh = new Mesh(roundedQuad(w, d, r), m);
  mesh.position.set(-0.004, 0.0004, -0.004);
  mesh.renderOrder = -1;
  return mesh;
}
