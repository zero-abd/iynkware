/**
 * The pending wire: an inked jumper in the look kit's own material (banded body, ink rim, flat cobalt shadow, the same
 * arch as `look/wires.ts`), drawn from the start anchor to wherever the hand aims. One geometry made once; every frame
 * `set` rewrites its position and normal attributes in place (`tube.ts`), so nothing allocates while it is drawn. The
 * rim reads the body's own normals and the shadow its positions, so one rewrite moves all three.
 */
import { LineCurve3, Mesh, MeshStandardMaterial, TubeGeometry, Vector3, type BufferAttribute, type Material, type Object3D } from '@iwsdk/core';
import { inkKit, loadInk, paintBands, type InkKit } from '../../look/ink';
import { bandsOf, WIRE } from '../../look/palette';
import { RADIAL, RADIUS, SEGMENTS, VERTICES, writeTube } from './tube';

export interface PendingWire {
  /** Moves the free end (and the start) to these board frame points; shows the wire if it was hidden. */
  set(a: Vector3, b: Vector3): void;
  hide(): void;
  readonly shown: boolean;
  dispose(): void;
}

/** The colour a pending wire has, as the project's blue (the first of `WIRE_PALETTE`). */
export const PENDING_COLOUR = WIRE.blue!;

export function createPendingWire(root: Object3D): PendingWire {
  const geometry = new TubeGeometry(new LineCurve3(new Vector3(), new Vector3(1, 0, 0)), SEGMENTS, RADIUS, RADIAL, false);
  paintBands(geometry, bandsOf(PENDING_COLOUR));
  const position = geometry.attributes.position as BufferAttribute;
  const normal = geometry.attributes.normal as BufferAttribute;
  if (position.count !== VERTICES) throw new Error('bench/wire: the tube layout changed');
  let body: Mesh | null = null;
  let shadow: Mesh | null = null;
  let kit: InkKit | null = null;
  let material: Material | null = null;
  let want = false;
  let written = false;
  let disposed = false;

  const apply = () => {
    if (body) body.visible = want && written;
    if (shadow) shadow.visible = want && written;
  };

  void loadInk().then((ink) => {
    if (disposed) return;
    if (ink) {
      kit = inkKit(ink, root);
      material = kit.body(geometry, 'sun');
    } else material = new MeshStandardMaterial({ color: PENDING_COLOUR, roughness: 0.6 });
    body = new Mesh(geometry, material);
    body.name = 'bench:wire-pending';
    body.frustumCulled = false;
    body.raycast = () => undefined;
    root.add(body);
    if (kit) {
      const rim = kit.outline(body, 2.2);
      rim.raycast = () => undefined;
      rim.frustumCulled = false;
      shadow = kit.shadow(body, 0);
      shadow.raycast = () => undefined;
      shadow.name = 'bench:wire-pending-shadow';
    }
    apply();
  });

  return {
    set(a, b) {
      if (!writeTube(position.array as Float32Array, normal.array as Float32Array, a.x, a.y, a.z, b.x, b.y, b.z)) return;
      position.needsUpdate = true;
      normal.needsUpdate = true;
      if (!want) kit?.relight();
      want = true;
      written = true;
      apply();
    },
    hide() {
      want = false;
      apply();
    },
    get shown() {
      return want && written;
    },
    dispose() {
      disposed = true;
      body?.removeFromParent();
      shadow?.removeFromParent();
      for (const m of [shadow?.material, body?.children[0] && (body.children[0] as Mesh).material, material]) (m as Material | undefined)?.dispose();
      geometry.dispose();
      body = null;
      shadow = null;
    },
  };
}
