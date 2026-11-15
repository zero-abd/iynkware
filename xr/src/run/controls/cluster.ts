/**
 * The run cluster's objects on the front rail (6.1): Reset, Step, Run/Pause (primary, 64 mm) and Speed as inked plate
 * buttons, left to right within x -0.15 to +0.15 m, with the clock chip above the row. Lies on the rail's tilted face
 * at `runLayout(...).cluster`. Draws only; `index.ts` decides what each plate shows.
 */
import { Group, Vector3 } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Lang, Vec3 } from '../../contracts/common';
import type { XrSettings } from '../../contracts/settings';
import { runLayout } from '../kit/layout';
import { plateButton, type Plate } from '../kit/plate';
import { textChip, type Chip } from '../kit/chip';
import type { Control } from './machine';

/** Plate sizes, metres: the primary is at least 60 mm (2.6), the rest keep a 48 mm poke hit. */
const SIDE = { w: 0.05, d: 0.048 };
const PRIMARY = { w: 0.064, d: 0.056 };
const GAP = 0.014;
const ORDER: readonly Control[] = ['reset', 'step', 'run', 'speed'];

export interface Cluster {
  readonly group: Group;
  readonly plates: Readonly<Record<Control, Plate>>;
  /** A drone's Run here, right of Run (shown by `drone(true)`). */
  readonly here: Plate;
  readonly clock: Chip;
  /** A drone project: only Run (Run on range) and Run here show; Reset, Step and Speed hide. */
  drone(on: boolean): void;
  /** Puts the cluster on the rail for this posture and hand. */
  place(posture: XrSettings['posture'], hand: XrSettings['dominantHand']): void;
  /** World position of a plate's top, for cues. */
  worldOf(control: Control): Vec3;
  dispose(): void;
}

export function createCluster(app: XrApp, lang: Lang): Cluster {
  const group = new Group();
  group.name = 'run-cluster';
  const row = new Group();
  group.add(row);
  const look = { icon: null, label: '', lang } as const;
  const plates = {
    reset: plateButton(app, SIDE, { ...look, icon: 'reset' }),
    step: plateButton(app, SIDE, { ...look, icon: 'step' }),
    run: plateButton(app, { ...PRIMARY, primary: true }, { ...look, icon: 'run' }),
    speed: plateButton(app, SIDE, { ...look, icon: 'speed' }),
  } satisfies Record<Control, Plate>;
  const width = (c: Control) => (c === 'run' ? PRIMARY.w : SIDE.w);
  const total = ORDER.reduce((sum, c) => sum + width(c), 0) + GAP * (ORDER.length - 1);
  let x = -total / 2;
  for (const c of ORDER) {
    const p = plates[c];
    p.hit.name = `run:${c}`;
    p.group.position.x = x + width(c) / 2;
    x += width(c) + GAP;
    row.add(p.group);
  }

  // A drone's Run here: as big as Run, just right of it (where Speed is; Speed hides for a drone).
  const here = plateButton(app, { ...PRIMARY, primary: true }, { ...look, icon: 'run' });
  here.hit.name = 'run:here';
  here.group.position.x = plates.run.group.position.x + PRIMARY.w + GAP;
  here.group.visible = false;
  row.add(here.group);

  // The clock: mono at 22 dmm, lying in the rail's plane just above (beyond) the row.
  const clock = textChip({ widthDmm: 280, lines: 1, sizeDmm: 22, distanceM: 0.47, mono: true });
  clock.group.name = 'run-clock';
  clock.group.rotation.x = -Math.PI / 2;
  clock.group.position.set(0, 0.0012, -(PRIMARY.d / 2 + 0.006 + clock.h / 2));
  group.add(clock.group);

  const at = new Vector3();
  return {
    group,
    plates,
    here,
    clock,
    drone(on) {
      plates.reset.group.visible = plates.step.group.visible = plates.speed.group.visible = !on;
      here.group.visible = on;
    },
    place(posture, hand) {
      const spot = runLayout(posture, hand).cluster;
      group.position.set(spot.position[0], spot.position[1], spot.position[2]);
      group.rotation.set(spot.tiltRad, spot.yawRad, 0, 'YXZ');
    },
    worldOf(control) {
      plates[control].hit.getWorldPosition(at);
      return [at.x, at.y, at.z];
    },
    dispose() {
      for (const c of ORDER) plates[c].dispose();
      here.dispose();
      clock.dispose();
      group.removeFromParent();
    },
  };
}
