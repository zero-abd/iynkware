/**
 * The look kit's door to the ink material (`tools/xr-assets/material/ink.js`, the asset pipeline's, #112): the one
 * material the converted figures are drawn in, so what the kit draws itself (the mat, the rail, wires) is drawn in it
 * too, never in a second material. It loads as the same lazy chunk the converted assets use (assets/converted.ts).
 *
 *   const ink = await loadInk();                         // null when the material is not in the tree
 *   const kit = inkKit(ink, root);                       // one set of shared uniforms, lit by the bench's sun
 *   paintBands(geometry, BANDS.mat);                     // the figure's light / mid / dark bands per vertex
 *   const body = new Mesh(geometry, kit.body(geometry)); // banded by the sun, double sided
 *   kit.outline(body);                                   // the heavy ink silhouette, constant on screen
 *   kit.shadow(body);                                    // the flat cobalt cast shadow on the mat (y = 0 of root)
 */
import { Box3, BufferAttribute, BufferGeometry, Color, Vector3, type Material, type Mesh, type Object3D } from '@iwsdk/core';
import { BENCH_LOOK } from './light';
import type { Bands } from './palette';

export type InkShade = 'sun' | 'fixed' | 'flat';
export interface InkLook {
  readonly sun?: readonly number[];
  readonly fixedLight?: readonly number[];
  readonly shadowLength?: number;
  readonly ink?: string;
  readonly shadow?: string;
}
/** The uniforms one item's ink materials share (ink.js `createInkUniforms`). */
export type InkUniforms = Record<string, { value: unknown }>;

/** What ink.js gives; only what the kit uses. */
export interface InkJs {
  createInkUniforms(look?: InkLook): InkUniforms;
  updateInkLights(uniforms: InkUniforms, look: InkLook, root: Object3D): void;
  createInkMaterial(o: { shade?: InkShade; look?: InkLook; geometry?: BufferGeometry; uniforms?: InkUniforms; opacity?: number; depthPull?: number; name?: string }): Material;
  setInkOpacity(material: Material, opacity: number): void;
  createOutline(source: Mesh | Mesh[], o?: { width?: number; uniforms?: InkUniforms; look?: InkLook; attach?: boolean; outScale?: number; faces?: 'back' | 'all'; pushK?: number }): Mesh;
  createShadow(source: Mesh | Mesh[], o?: { look?: InkLook; root?: Object3D; planeY?: number; uniforms?: InkUniforms; attach?: boolean }): Mesh;
}

const modules = import.meta.glob('../../../tools/xr-assets/material/ink.js');
let loading: Promise<InkJs | null> | undefined;

/** The ink material module, loaded once; null (and one warning) when it is not in the tree or fails to load. */
export function loadInk(): Promise<InkJs | null> {
  loading ??= (async () => {
    const load = Object.values(modules)[0];
    if (!load) return null;
    try {
      return (await load()) as InkJs;
    } catch (e) {
      console.warn('[look] the ink material did not load; the kit draws plain colours', e);
      return null;
    }
  })();
  return loading;
}

const _c = new Color();

/**
 * Writes a figure material's three bands into a geometry's vertex attributes, as the converter does (`color` the light
 * band, `_ink_mid`, `_ink_dark`, all linear). `bands` may also be a function of the vertex index, for geometry that
 * carries several materials.
 */
export function paintBands(geometry: BufferGeometry, bands: Bands | ((i: number) => Bands)): BufferGeometry {
  const n = geometry.attributes.position!.count;
  const l = new Float32Array(n * 3), m = new Float32Array(n * 3), d = new Float32Array(n * 3);
  const one = typeof bands === 'function' ? null : bands;
  for (let i = 0; i < n; i++) {
    const b = one ?? (bands as (i: number) => Bands)(i);
    _c.set(b.l).toArray(l, i * 3);
    _c.set(b.m).toArray(m, i * 3);
    _c.set(b.d).toArray(d, i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(l, 3));
  geometry.setAttribute('_ink_mid', new BufferAttribute(m, 3));
  geometry.setAttribute('_ink_dark', new BufferAttribute(d, 3));
  return geometry;
}

/**
 * The silhouette's push direction per vertex: the mean of the normals of every vertex at the same place, so a hard
 * edge (a box's, a slab's) opens no crack in the ink rim. Written as `_outline_normal`.
 */
export function smoothOutlineNormals(geometry: BufferGeometry, quantum = 1e-5): BufferGeometry {
  const pos = geometry.attributes.position!;
  const nor = geometry.attributes.normal!;
  const sums = new Map<string, Vector3>();
  // Each distinct face direction counts once at a place, however many of its triangles meet there.
  const seen = new Set<string>();
  const keyOf = (i: number) => `${Math.round(pos.getX(i) / quantum)},${Math.round(pos.getY(i) / quantum)},${Math.round(pos.getZ(i) / quantum)}`;
  const keys: string[] = [];
  for (let i = 0; i < pos.count; i++) {
    const k = keyOf(i);
    keys.push(k);
    let s = sums.get(k);
    if (!s) sums.set(k, (s = new Vector3()));
    const dir = `${k}|${Math.round(nor.getX(i) * 1000)},${Math.round(nor.getY(i) * 1000)},${Math.round(nor.getZ(i) * 1000)}`;
    if (seen.has(dir)) continue;
    seen.add(dir);
    s.x += nor.getX(i);
    s.y += nor.getY(i);
    s.z += nor.getZ(i);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(keys[i]!)!;
    const len = s.length() || 1;
    out[i * 3] = s.x / len;
    out[i * 3 + 1] = s.y / len;
    out[i * 3 + 2] = s.z / len;
  }
  geometry.setAttribute('_outline_normal', new BufferAttribute(out, 3));
  return geometry;
}

export interface InkKit {
  readonly ink: InkJs;
  readonly uniforms: InkUniforms;
  /** A band material for `geometry` (its attributes pick the shader's defines). */
  body(geometry: BufferGeometry, shade?: InkShade): Material;
  /** The ink silhouette of `mesh`, added as its child; `width` in figure ink units (2.8 the figure's heavy line). */
  outline(mesh: Mesh, width?: number): Mesh;
  /** The flat cast shadow of `mesh` on y = `planeY` of the kit's root, added to the root. */
  shadow(mesh: Mesh, planeY?: number): Mesh;
  /** Turns the sun with the root (call after the root is turned). */
  relight(): void;
}

/** Ink for things drawn in `root`'s frame (the table or the board frame), lit by the bench's figure light. */
export function inkKit(ink: InkJs, root: Object3D, look: InkLook = BENCH_LOOK): InkKit {
  const uniforms = ink.createInkUniforms(look);
  const relight = () => {
    root.updateWorldMatrix(true, false);
    ink.updateInkLights(uniforms, look, root);
  };
  relight();
  return {
    ink,
    uniforms,
    body: (geometry, shade = 'sun') => ink.createInkMaterial({ shade, look, geometry, uniforms }),
    outline: (mesh, width = 2.8) => ink.createOutline(mesh, { width, uniforms, look, attach: true }),
    shadow: (mesh, planeY = 0) => ink.createShadow(mesh, { look, root, planeY, uniforms, attach: true }),
    relight,
  };
}

/** The ink helpers drawn around a body: none of them is where the body is (fat lines and halos are screen quads). */
const HELPERS = new Set(['line', 'outline', 'shadow', 'glow', 'text']);

/**
 * The bounds of what an object draws as bodies, in world space: like `Box3.setFromObject`, but without the ink helpers
 * (a fat line's or a halo's geometry is a unit quad placed by its shader, so it would make the box metres wide).
 */
export function drawnBox(object: Object3D, out: Box3 = new Box3()): Box3 {
  out.makeEmpty();
  object.updateWorldMatrix(true, true);
  const box = new Box3();
  object.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || HELPERS.has(mesh.userData.inkRole as string)) return;
    const g = mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    if (!g.boundingBox || g.boundingBox.isEmpty()) return;
    out.union(box.copy(g.boundingBox).applyMatrix4(mesh.matrixWorld));
  });
  return out;
}
