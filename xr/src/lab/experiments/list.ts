/**
 * Every experiment, and what each lab puts on the bench when it is opened before an experiment is picked (its whole
 * kit: every item the lab has). Starting an experiment lays out that experiment's own kit instead.
 */
import type { LabId } from '../model/types';
import { FLAME_TEST, PH_OF_A_LIQUID } from './chemistry';
import { OHMS_LAW } from './electrical';
import { PENDULUM } from './physics';
import { MEASURE_WAVE } from './signals';
import type { Experiment, KitItem } from './types';

export const EXPERIMENTS: readonly Experiment[] = [FLAME_TEST, PH_OF_A_LIQUID, OHMS_LAW, PENDULUM, MEASURE_WAVE];

export const experimentsOf = (lab: LabId): readonly Experiment[] => EXPERIMENTS.filter((e) => e.lab === lab);
export const experimentById = (id: string): Experiment | undefined => EXPERIMENTS.find((e) => e.id === id);

/** A lab's bench when it opens: millimetres on the table, x right, z towards the person. */
export const LAB_LAYOUTS: Readonly<Record<LabId, readonly KitItem[]>> = {
  chemistry: [
    { kind: 'bunsen-burner', x: 70, z: -90 },
    { kind: 'flame-test-kit', x: -170, z: 20 },
    { kind: 'beaker-250', x: 250, z: -20 },
    { kind: 'erlenmeyer-250', x: 330, z: -110 },
    { kind: 'ph-meter', x: -330, z: -90 },
  ],
  physics: [{ kind: 'pendulum-stand', x: 0, z: -110 }],
  electrical: [
    { kind: 'bench-power-supply', x: -120, z: -70 },
    { kind: 'soldering-station', x: 170, z: -60 },
  ],
  signals: [
    { kind: 'function-generator', x: -200, z: -40 },
    { kind: 'oscilloscope', x: 120, z: -80 },
  ],
};
