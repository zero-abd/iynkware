/**
 * Ghosts of a proposed step, in the bench's board frame: a part drawn in the accent at the pose the bench will give
 * it, a wire as a ghost tube along the bench's wire arc, and the solid tube the companion draws on from end to end.
 * A ghost is the part's own instance (`PartAsset.instantiate`) with its materials swapped, so it has exactly the
 * part's shape; what the instance owns (its channel nodes' materials) is disposed with it, shared things never.
 */
import {
  Mesh,
  MeshBasicMaterial,
  QuadraticBezierCurve3,
  TubeGeometry,
  Vector3,
  type Material,
  type Object3D,
} from '@iwsdk/core';
import type { PartAsset } from '../../contracts/assets';
import { ACCENT, hexNum, WIRE, WIRE_FALLBACK } from '../../look/palette';
import type { Pose } from './pose';
import { wireControl } from './pose';

/** The ghost's look: the accent, see-through, never hiding what is under it. */
const GHOST_OPACITY = 0.42;
/** The bench's default wire tube (`xr/src/bench/space.ts`): 20 segments, 0.9 mm radius, 6 sides, board frame. */
const TUBE = { segments: 24, radius: 0.0009, sides: 6 } as const;

function ownedMaterials(asset: PartAsset, object: Object3D): Set<Material> {
  const seen = new Set<Material>();
  for (const ch of asset.sidecar.channels) {
    for (const name of ch.nodes) {
      object.getObjectByName(name)?.traverse((o) => {
        const m = (o as Mesh).material;
        if (m) for (const x of Array.isArray(m) ? m : [m]) seen.add(x);
      });
    }
  }
  return seen;
}

export interface PartGhost {
  readonly object: Object3D;
  /** 0..1 of the ghost's own opacity. */
  setOpacity(a: number): void;
  dispose(): void;
}

/** A part's ghost at `pose`. */
export function ghostPart(asset: PartAsset, pose: Pose): PartGhost {
  const object = asset.instantiate();
  object.name = `assistant:ghost:${asset.ref}`;
  const owned = ownedMaterials(asset, object);
  const mat = new MeshBasicMaterial({ color: hexNum(ACCENT), transparent: true, opacity: GHOST_OPACITY, depthWrite: false, toneMapped: false });
  object.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) {
      m.material = mat;
      m.renderOrder = 3;
    }
  });
  object.position.copy(pose.position);
  object.rotation.set(0, pose.yaw, 0);
  return {
    object,
    setOpacity: (a) => {
      mat.opacity = GHOST_OPACITY * a;
      object.visible = a > 0.01;
    },
    dispose() {
      object.removeFromParent();
      mat.dispose();
      for (const m of owned) m.dispose();
    },
  };
}

/** A part as itself (its own materials), for the companion to carry. */
export function carriedPart(asset: PartAsset, pose: Pose): { object: Object3D; dispose(): void } {
  const object = asset.instantiate();
  object.name = `assistant:carried:${asset.ref}`;
  object.position.copy(pose.position);
  object.rotation.set(0, pose.yaw, 0);
  const owned = ownedMaterials(asset, object);
  return {
    object,
    dispose() {
      object.removeFromParent();
      for (const m of owned) m.dispose();
    },
  };
}

export interface WireGhost {
  readonly mesh: Mesh;
  readonly curve: QuadraticBezierCurve3;
  setOpacity(a: number): void;
  /** Shows the first `k` (0..1) of the tube, from its first end. */
  drawTo(k: number): void;
  dispose(): void;
}

/** The colour a document wire is drawn in. */
export const wireHex = (color: string | undefined): string => (color && WIRE[color]) || WIRE_FALLBACK;

/** A wire tube from `a` to `b` (board frame) along the bench's arc: a ghost, or `solid` for one being drawn on. */
export function wireTube(a: Vector3, b: Vector3, color: string | undefined, solid = false): WireGhost {
  const curve = new QuadraticBezierCurve3(a.clone(), wireControl(a, b), b.clone());
  const geometry = new TubeGeometry(curve, TUBE.segments, TUBE.radius * (solid ? 1 : 1.35), TUBE.sides, false);
  const opacity = solid ? 1 : GHOST_OPACITY;
  const mat = new MeshBasicMaterial({
    color: hexNum(solid ? wireHex(color) : ACCENT),
    transparent: !solid,
    opacity,
    depthWrite: solid,
    toneMapped: false,
  });
  const mesh = new Mesh(geometry, mat);
  mesh.name = solid ? 'assistant:wire' : 'assistant:ghost:wire';
  mesh.renderOrder = 3;
  const total = geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
  // Whole rings at a time: six indices per quad, `sides` quads per ring.
  const ring = TUBE.sides * 6;
  return {
    mesh,
    curve,
    setOpacity: (x) => {
      mat.opacity = opacity * x;
      mesh.visible = x > 0.01;
    },
    drawTo(k) {
      const n = k >= 1 ? total : Math.floor((total * Math.max(0, k)) / ring) * ring;
      geometry.setDrawRange(0, n >= total ? Infinity : n);
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      mat.dispose();
    },
  };
}
