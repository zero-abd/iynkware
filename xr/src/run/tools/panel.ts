/**
 * An inked panel that stands in reach zone 3 facing the eyes (docs/XR_DESIGN.md 9.1): a paper slab with its ink outline
 * and a flat blue shadow behind it, opened and closed by easing its scale, closed panels not drawn at all. The scope
 * screen and the serial panel are made on it; faces and hit planes are added to `front`, which sits on the slab.
 */
import { Group } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import { PAPER } from '../../look/palette';
import { animated, inkShadow, inkSolid, MOTION, roundedSlab, type Spot } from '../kit';

const THICK = 0.01;

export interface Panel {
  readonly group: Group;
  /** Children go here: the front face of the slab, facing +z, origin at its centre. */
  readonly front: Group;
  readonly w: number;
  readonly h: number;
  readonly isOpen: boolean;
  /** Eases open (true) or closed. A closed panel is not drawn and takes no rays. */
  open(on: boolean): void;
  place(spot: Spot): void;
  dispose(): void;
}

export function createPanel(app: XrApp, w: number, h: number, name: string): Panel {
  const group = new Group();
  group.name = name;
  const slab = new Group();
  slab.rotation.x = Math.PI / 2;
  const solid = inkSolid(roundedSlab(w, h, THICK, 0.014), PAPER);
  slab.add(solid.group);
  group.add(slab);
  // The flat shadow, 6 dmm right and down, behind the slab.
  const shadow = inkShadow(w, h, 0.014);
  shadow.rotation.x = Math.PI / 2;
  shadow.position.set(0.006, -0.006, -0.002);
  shadow.raycast = () => undefined;
  group.add(shadow);
  const front = new Group();
  front.position.z = THICK + 0.0003;
  group.add(front);

  let isOpen = false;
  const grow = animated(
    app,
    0,
    (v) => {
      group.visible = v > 0.001;
      group.scale.setScalar(0.92 + 0.08 * v);
    },
    'fade',
  );
  group.visible = false;

  return {
    group,
    front,
    w,
    h,
    get isOpen() {
      return isOpen;
    },
    open(on) {
      if (on === isOpen) return;
      isOpen = on;
      grow.to(on ? 1 : 0, MOTION.settle);
    },
    place(spot) {
      group.position.set(spot.position[0], spot.position[1], spot.position[2]);
      group.rotation.set(spot.tiltRad, spot.yawRad, 0, 'YXZ');
    },
    dispose() {
      grow.dispose();
      solid.dispose();
      shadow.geometry.dispose();
      group.removeFromParent();
    },
  };
}
