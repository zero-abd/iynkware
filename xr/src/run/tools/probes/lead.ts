/**
 * A probe's lead: a thin tube along a drooping curve from the meter's jack to the probe's end, drawn as one mesh whose
 * vertices are rewritten in place (a few segments, a few sides). `update` allocates nothing and does nothing when
 * neither end moved. Unlit, in the lead's colour; it takes no rays.
 */
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, Vector3 } from '@iwsdk/core';

const SEGMENTS = 10;
const SIDES = 5;
const RADIUS = 0.0017;
/** How far the lead sags below the straight line between its ends, metres. */
const SAG = 0.045;
/** The lowest the lead goes: it rests on the mat, not through it. */
const FLOOR = RADIUS * 1.5;

export interface Lead {
  readonly mesh: Mesh;
  /** Sets both ends in the mesh's parent frame. Returns whether the curve changed. */
  update(from: Vector3, to: Vector3): boolean;
  dispose(): void;
}

export function createLead(color: string): Lead {
  const rings = SEGMENTS + 1;
  const positions = new Float32Array(rings * SIDES * 3);
  const index: number[] = [];
  for (let s = 0; s < SEGMENTS; s++) {
    for (let k = 0; k < SIDES; k++) {
      const a = s * SIDES + k;
      const b = s * SIDES + ((k + 1) % SIDES);
      index.push(a, b, a + SIDES, b, b + SIDES, a + SIDES);
    }
  }
  const geometry = new BufferGeometry();
  const attribute = new BufferAttribute(positions, 3);
  attribute.setUsage(35048); // DynamicDrawUsage
  geometry.setAttribute('position', attribute);
  geometry.setIndex(index);
  const material = new MeshBasicMaterial({ color });
  const mesh = new Mesh(geometry, material);
  mesh.raycast = () => undefined;
  mesh.frustumCulled = false;

  const a = new Vector3();
  const b = new Vector3();
  const control = new Vector3();
  const point = new Vector3();
  const next = new Vector3();
  const tangent = new Vector3();
  const side = new Vector3();
  const up = new Vector3();
  const lastA = new Vector3(NaN, 0, 0);
  const lastB = new Vector3();

  const at = (t: number, out: Vector3): Vector3 => {
    const u = 1 - t;
    return out
      .set(0, 0, 0)
      .addScaledVector(a, u * u)
      .addScaledVector(control, 2 * u * t)
      .addScaledVector(b, t * t);
  };

  return {
    mesh,
    update(from, to) {
      if (lastA.equals(from) && lastB.equals(to)) return false;
      lastA.copy(from);
      lastB.copy(to);
      a.copy(from);
      b.copy(to);
      control.copy(a).add(b).multiplyScalar(0.5);
      control.y = Math.max(FLOOR, Math.min(control.y - SAG, Math.min(a.y, b.y)));
      for (let s = 0; s < rings; s++) {
        const t = s / SEGMENTS;
        at(t, point);
        at(Math.min(1, t + 0.02), next);
        tangent.copy(next).sub(at(Math.max(0, t - 0.02), side)).normalize();
        side.set(0, 1, 0).cross(tangent);
        if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
        side.normalize();
        up.copy(tangent).cross(side).normalize();
        for (let k = 0; k < SIDES; k++) {
          const angle = (k / SIDES) * Math.PI * 2;
          const c = Math.cos(angle) * RADIUS;
          const d = Math.sin(angle) * RADIUS;
          const o = (s * SIDES + k) * 3;
          positions[o] = point.x + side.x * c + up.x * d;
          positions[o + 1] = point.y + side.y * c + up.y * d;
          positions[o + 2] = point.z + side.z * c + up.z * d;
        }
      }
      attribute.needsUpdate = true;
      return true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
