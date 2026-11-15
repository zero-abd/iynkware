/**
 * The pillar's own live copy of the bench's board (`BenchSpace.root`). It is a deep clone with its own cloned
 * materials (geometry is shared, the bench's materials are never written), not raycastable and bound to no input.
 * Flat arrays of [source, copy] node pairs and material pairs are built when the copy is (re)built; `sync` walks them
 * each frame, so a frame allocates nothing. The copy's root maps the board frame to the world.
 */
import { Box3, Group, Matrix4, Vector3, type Material, type Mesh, type Object3D } from '@iwsdk/core';
import { EMPTY_SIDE, type Extent } from './size';

interface MaterialLike extends Material {
  color?: { copy(c: unknown): unknown };
  emissive?: { copy(c: unknown): unknown };
  uniforms?: Record<string, { value: unknown }>;
}

export interface RoomCopy {
  /** The copy's root: a child of the scene (the caller adds it), board frame, scaled and placed by the caller. */
  readonly root: Group;
  /** Mirrors the source's node transforms, visibility and material state, with every material at `opacity`. */
  sync(opacity: number): void;
  /** The board's horizontal extent in the board frame, measured with the copy at identity (scale 1). */
  extent(): Extent;
  /** Removes the copy from its parent and disposes its materials (geometry is the bench's). */
  dispose(): void;
}

const noRaycast = () => undefined;

/**
 * `clone` copies `userData` through JSON, and the bench keeps circular asset records there: clone with it set aside.
 * The copy gets no user data, so nothing that looks one up (the bench's `partOf`) can mistake it for the bench.
 */
function cloneBare<T extends { userData: Record<string, unknown>; clone(...a: never[]): unknown }>(src: T, ...args: unknown[]): T {
  const ud = src.userData;
  src.userData = {};
  try {
    return (src.clone as (...a: unknown[]) => T).apply(src, args);
  } finally {
    src.userData = ud;
  }
}
const isMesh = (o: Object3D): o is Mesh => (o as Mesh).isMesh === true;

/** Builds a copy of `source` (a clone of its whole tree, root excluded from the node pairs). */
export function buildRoomCopy(source: Object3D): RoomCopy {
  source.updateMatrixWorld(true);
  const root = new Group();
  root.name = 'scale-room-copy';
  const pairs: Object3D[] = []; // [source, copy, source, copy, ...] for every node under the root
  const mats: MaterialLike[] = []; // [source, copy, ...]
  const matOf = new Map<Material, Material>();
  const ownOf = (m: Material): Material => {
    let c = matOf.get(m);
    if (!c) {
      c = cloneBare(m);
      matOf.set(m, c);
      mats.push(m as MaterialLike, c as MaterialLike);
    }
    return c;
  };
  const copyNode = (src: Object3D, parent: Object3D): void => {
    let node: Object3D;
    if (isMesh(src)) {
      const mesh = cloneBare(src, false) as Mesh;
      mesh.material = Array.isArray(src.material) ? src.material.map(ownOf) : ownOf(src.material);
      node = mesh;
    } else {
      node = cloneBare(src, false);
    }
    node.raycast = noRaycast;
    node.userData = {};
    node.name = src.name;
    parent.add(node);
    pairs.push(src, node);
    for (const child of src.children) copyNode(child, node);
  };
  for (const child of source.children) copyNode(child, root);

  const inverse = new Matrix4();
  const m = new Matrix4();
  const box = new Box3();
  const corner = new Vector3();

  const sync = (opacity: number): void => {
    for (let i = 0; i < pairs.length; i += 2) {
      const s = pairs[i]!;
      const c = pairs[i + 1]!;
      c.position.copy(s.position);
      c.quaternion.copy(s.quaternion);
      c.scale.copy(s.scale);
      c.visible = s.visible;
    }
    for (let i = 0; i < mats.length; i += 2) {
      const s = mats[i]!;
      const c = mats[i + 1]!;
      if (c.color && s.color) c.color.copy(s.color);
      if (c.emissive && s.emissive) c.emissive.copy(s.emissive);
      const o = s.opacity * opacity;
      if (c.opacity !== o) c.opacity = o;
      const transparent = s.transparent || opacity < 1;
      if (c.transparent !== transparent) {
        c.transparent = transparent;
        c.needsUpdate = true;
      }
      const u = c.uniforms?.opacity;
      if (u && typeof u.value === 'number') u.value = o;
    }
  };
  sync(1);

  return {
    root,
    sync,
    extent() {
      // Measure in the board frame whatever the copy's current transform is.
      root.updateMatrixWorld(true);
      inverse.copy(root.matrixWorld).invert();
      box.makeEmpty();
      root.traverse((o) => {
        if (!isMesh(o)) return;
        for (let p: Object3D | null = o; p && p !== root; p = p.parent) if (!p.visible) return;
        const g = o.geometry;
        // Hit proxies and other meshes that are never drawn do not count towards the board's size.
        const first = Array.isArray(o.material) ? o.material[0] : o.material;
        // Instanced geometry (fat wire lines) holds one unit segment, not the wire: its box says nothing about the board.
        if (!g || !first || first.visible === false || (g as { isInstancedBufferGeometry?: boolean }).isInstancedBufferGeometry) return;
        if (!g.boundingBox) g.computeBoundingBox();
        const b = g.boundingBox;
        if (!b || b.isEmpty()) return;
        m.multiplyMatrices(inverse, o.matrixWorld);
        for (let i = 0; i < 8; i++) {
          corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(m);
          box.expandByPoint(corner);
        }
      });
      if (box.isEmpty()) return { minX: -EMPTY_SIDE / 2, maxX: EMPTY_SIDE / 2, minZ: -EMPTY_SIDE / 2, maxZ: EMPTY_SIDE / 2 };
      return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
    },
    dispose() {
      root.removeFromParent();
      for (let i = 1; i < mats.length; i += 2) mats[i]!.dispose();
      pairs.length = 0;
      mats.length = 0;
    },
  };
}
