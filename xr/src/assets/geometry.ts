/**
 * Geometry for placeholder assets: boxes, cylinders and domes, merged into one BufferGeometry so a part's static pieces
 * cost one draw call. A merged geometry can carry a colour per piece (a vertex colour), so a body and its legs share one
 * mesh and one material. Every helper takes part frame millimetres (x, up, z) and returns geometry in metres.
 */
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, SphereGeometry } from '@iwsdk/core';

/** Radial segments of round pieces. Low on purpose: a leg-sized cylinder needs no more on a headset. */
const SEGMENTS = 16;

/** Part frame millimetres: x right, up, z toward the person. */
export type Mm3 = readonly [x: number, up: number, z: number];

const M = 1 / 1000;

/** One piece of a merged geometry. */
export interface Solid {
  readonly geometry: BufferGeometry;
  /** Vertex colour of the piece. Omit on every piece for a geometry without a colour attribute. */
  readonly colour?: Color;
}

/** An axis-aligned box from its min and max corners. */
export function box(min: Mm3, max: Mm3): BufferGeometry {
  const g = new BoxGeometry((max[0] - min[0]) * M, (max[1] - min[1]) * M, (max[2] - min[2]) * M);
  g.translate(((min[0] + max[0]) / 2) * M, ((min[1] + max[1]) / 2) * M, ((min[2] + max[2]) / 2) * M);
  return g;
}

/** An upright cylinder (axis +y) standing on `base`. */
export function cylinderUp(base: Mm3, radius: number, height: number): BufferGeometry {
  const g = new CylinderGeometry(radius * M, radius * M, height * M, SEGMENTS, 1);
  g.translate(base[0] * M, (base[1] + height / 2) * M, base[2] * M);
  return g;
}

/** A cylinder lying along x, centred on `centre`. */
export function cylinderAlongX(centre: Mm3, radius: number, length: number): BufferGeometry {
  const g = new CylinderGeometry(radius * M, radius * M, length * M, SEGMENTS, 1);
  g.rotateZ(Math.PI / 2);
  g.translate(centre[0] * M, centre[1] * M, centre[2] * M);
  return g;
}

/** The upper half of a sphere centred on `centre`. */
export function dome(centre: Mm3, radius: number): BufferGeometry {
  const g = new SphereGeometry(radius * M, SEGMENTS, SEGMENTS / 2, 0, Math.PI * 2, 0, Math.PI / 2);
  g.translate(centre[0] * M, centre[1] * M, centre[2] * M);
  return g;
}

/**
 * Merges pieces into one indexed geometry with positions and normals (and colours when the pieces have them). UVs are
 * dropped: placeholders are flat colour. The pieces are disposed, and the result has its bounds computed.
 */
export function mergeSolids(solids: readonly Solid[]): BufferGeometry {
  const coloured = solids.some((s) => s.colour !== undefined);
  let vertices = 0;
  let indices = 0;
  for (const { geometry } of solids) {
    vertices += geometry.getAttribute('position').count;
    indices += geometry.index?.count ?? geometry.getAttribute('position').count;
  }
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const colours = coloured ? new Float32Array(vertices * 3) : undefined;
  const index = vertices > 0xffff ? new Uint32Array(indices) : new Uint16Array(indices);

  let v = 0;
  let i = 0;
  for (const { geometry, colour } of solids) {
    const pos = geometry.getAttribute('position');
    const nor = geometry.getAttribute('normal');
    for (let k = 0; k < pos.count; k++) {
      const o = (v + k) * 3;
      positions[o] = pos.getX(k);
      positions[o + 1] = pos.getY(k);
      positions[o + 2] = pos.getZ(k);
      normals[o] = nor.getX(k);
      normals[o + 1] = nor.getY(k);
      normals[o + 2] = nor.getZ(k);
      if (colours) {
        colours[o] = colour?.r ?? 1;
        colours[o + 1] = colour?.g ?? 1;
        colours[o + 2] = colour?.b ?? 1;
      }
    }
    const src = geometry.index;
    if (src) for (let k = 0; k < src.count; k++) index[i + k] = src.getX(k) + v;
    else for (let k = 0; k < pos.count; k++) index[i + k] = k + v;
    i += src?.count ?? pos.count;
    v += pos.count;
    geometry.dispose();
  }

  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(positions, 3));
  merged.setAttribute('normal', new BufferAttribute(normals, 3));
  if (colours) merged.setAttribute('color', new BufferAttribute(colours, 3));
  merged.setIndex(new BufferAttribute(index, 1));
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
