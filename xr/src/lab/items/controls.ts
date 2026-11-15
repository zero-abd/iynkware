/**
 * Where each item's controls are and what they do: pure data, so it is tested without a scene. Positions are the item
 * frame in metres (x right, y up, z out of the front), from the lab figures' anchors (`control:TAP`, `control:VSET`...)
 * where they exist. A control is a hit box bound for ray and poke; selecting it sends one action through the store.
 * A knob is two halves: the left steps down (`value: -1`), the right up (`+1`). `node` hangs the hit on a moving node
 * of the visual (the pendulum's bob) instead of the item root.
 */
import type { ItemState, LabAction } from '../model/types';
import type { ControlLabel } from './labels';

export type V3 = readonly [number, number, number];

export interface ControlSpec {
  readonly id: string;
  readonly at: V3;
  readonly size: V3;
  /** A word printed beside it (translated), or a symbol (`?`, `Li`) printed as it is. */
  readonly label?: ControlLabel;
  readonly symbol?: string;
  /** Where the label goes relative to the control: above (default) or in front, flat on the bench. */
  readonly labelAt?: V3;
  readonly node?: string;
  /** Knob: the action whose `value` is -1 or +1; two hits. */
  readonly knob?: string;
  /** The action for a plain control, from the item's state now. */
  action?(st: Readonly<ItemState>): LabAction;
}

const BTN: V3 = [0.032, 0.014, 0.016];
/** A point on the bench surface beside the item. */
const flat = (x: number, z: number): V3 => [x, 0.004, z];

/** A labelled pad on the bench in front of an item. */
const pad = (id: string, x: number, z: number, label: ControlLabel, action: (st: Readonly<ItemState>) => LabAction): ControlSpec => ({
  id,
  at: flat(x, z),
  size: [0.036, 0.01, 0.022],
  label,
  labelAt: [0, 0.009, 0],
  action,
});
const of = (type: string, value?: LabAction['value']) => () => (value === undefined ? { type } : { type, value });

export const SALT_DISHES = ['Li', 'Na', 'K', 'Ca', 'Cu', 'Sr', 'Ba', 'unknown'] as const;
/** x of each dish on the flame-test tray. */
export const dishX = (i: number): number => -0.105 + i * 0.03;
export const ACID_AT: V3 = [-0.075, 0.012, 0.04];
export const LOOP_REST: V3 = [0.06, 0.03, 0.045];

export const CONTROLS: Readonly<Record<string, readonly ControlSpec[]>> = {
  'bunsen-burner': [
    { id: 'tap', at: [-0.077, 0.04, -0.018], size: [0.045, 0.035, 0.045], label: 'gas', action: of('gas') },
    { id: 'collar', at: [0.055, 0.032, 0], size: [0.03, 0.026, 0.03], label: 'collar', labelAt: [0.045, 0, 0.02], action: of('collar') },
    pad('light', 0.0, 0.07, 'light', of('light')),
  ],
  'flame-test-kit': [
    ...SALT_DISHES.map((d, i): ControlSpec => ({
      id: `dish-${d}`,
      at: [dishX(i), 0.015, -0.025],
      size: [0.026, 0.02, 0.026],
      symbol: d === 'unknown' ? '?' : d,
      labelAt: [0, -0.008, 0.024],
      action: of('dip-salt', d),
    })),
    { id: 'acid', at: ACID_AT, size: [0.04, 0.025, 0.04], label: 'acid', labelAt: [0, 0.006, 0.032], action: of('dip-acid') },
    {
      id: 'loop',
      at: LOOP_REST,
      size: [0.09, 0.025, 0.025],
      label: 'loop',
      labelAt: [0, 0.02, 0],
      node: 'LOOP',
      action: (st) => (st.p.held === 'flame' ? { type: 'to-rack' } : { type: 'to-flame' }),
    },
  ],
  'beaker-250': [pad('fill', -0.04, 0.065, 'fill', of('fill')), pad('empty', 0, 0.065, 'empty', of('empty')), pad('heat', 0.04, 0.065, 'heat', of('heat'))],
  'erlenmeyer-250': [pad('fill', -0.04, 0.07, 'fill', of('fill')), pad('empty', 0, 0.07, 'empty', of('empty')), pad('swirl', 0.04, 0.07, 'swirl', of('swirl'))],
  'ph-meter': [
    { id: 'on', at: [-0.035, 0.05, 0.06], size: BTN, label: 'power', action: of('power') },
    { id: 'cal', at: [0.005, 0.05, 0.06], size: BTN, label: 'calibrate', action: of('calibrate') },
    { id: 'buffer', at: [-0.035, 0.05, 0.03], size: BTN, label: 'buffer', action: of('probe', 'buffer') },
    { id: 'rinse', at: [0.005, 0.05, 0.03], size: BTN, label: 'rinse', action: of('probe', 'rinse') },
    { id: 'sample', at: [-0.035, 0.05, 0.0], size: BTN, label: 'sample', action: of('probe', 'sample') },
    { id: 'store', at: [0.005, 0.05, 0.0], size: BTN, label: 'store', action: of('probe', 'stored') },
  ],
  'bench-power-supply': [
    { id: 'vset', at: [-0.038, 0.05, 0.106], size: [0.03, 0.03, 0.02], label: 'voltage', labelAt: [0, -0.024, 0.004], knob: 'vSet' },
    { id: 'iset', at: [0.038, 0.05, 0.106], size: [0.03, 0.03, 0.02], label: 'current', labelAt: [0, -0.024, 0.004], knob: 'iSet' },
    { id: 'power', at: [-0.052, 0.019, 0.104], size: [0.026, 0.02, 0.014], label: 'power', labelAt: [0, -0.016, 0.002], action: of('power') },
    { id: 'record', at: [-0.008, 0.019, 0.104], size: [0.03, 0.016, 0.014], label: 'record', labelAt: [0, -0.016, 0.002], action: of('record') },
    { id: 'load', at: [0, 0.01, 0.136], size: [0.05, 0.02, 0.025], label: 'load', labelAt: [0, 0.018, 0.01], action: of('load') },
  ],
  'soldering-station': [
    { id: 'power', at: [-0.075, 0.017, 0.066], size: [0.022, 0.02, 0.014], label: 'power', labelAt: [0, -0.016, 0.002], action: of('power') },
    { id: 'dial', at: [-0.052, 0.052, 0.072], size: [0.03, 0.03, 0.02], label: 'temp', labelAt: [0, 0.026, 0.002], knob: 'tempSet' },
    { id: 'iron', at: [0.042, 0.06, -0.02], size: [0.04, 0.08, 0.12], label: 'iron', labelAt: [0, 0.07, 0.04], action: of('iron') },
    { id: 'sponge', at: [0.042, 0.012, 0.075], size: [0.05, 0.02, 0.035], label: 'sponge', labelAt: [0, 0.016, 0.01], action: of('sponge') },
  ],
  'pendulum-stand': [
    { id: 'bob', at: [0, 0, 0], size: [0.035, 0.035, 0.035], node: 'BOB', action: of('swing') },
    pad('length', -0.06, 0.05, 'length', of('length')),
    pad('angle', 0, 0.05, 'angle', of('amplitude')),
    pad('record', 0.06, 0.05, 'record', of('record')),
  ],
  'function-generator': [
    { id: 'power', at: [0.088, 0.028, 0.101], size: [0.026, 0.018, 0.012], label: 'output', labelAt: [0, -0.016, 0.002], action: of('power') },
    { id: 'wave', at: [-0.085, 0.025, 0.101], size: [0.026, 0.018, 0.012], label: 'wave', labelAt: [0, -0.016, 0.002], action: of('wave') },
    { id: 'freq', at: [0.015, 0.03, 0.104], size: [0.028, 0.028, 0.018], label: 'freq', labelAt: [0, -0.024, 0.002], knob: 'freq' },
    { id: 'amp', at: [0.052, 0.03, 0.104], size: [0.028, 0.028, 0.018], label: 'amp', labelAt: [0, -0.024, 0.002], knob: 'amp' },
  ],
  oscilloscope: [
    { id: 'time', at: [0.085, 0.118, 0.104], size: [0.03, 0.03, 0.018], label: 'timeDiv', labelAt: [0, 0.024, 0.002], knob: 'timeDiv' },
    { id: 'volts', at: [0.13, 0.118, 0.104], size: [0.03, 0.03, 0.018], label: 'voltsDiv', labelAt: [0, 0.024, 0.002], knob: 'voltsDiv' },
    { id: 'measure', at: [0.108, 0.07, 0.101], size: [0.04, 0.018, 0.012], label: 'measure', labelAt: [0, -0.016, 0.002], action: of('measure') },
    { id: 'probe', at: [0.085, 0.03, 0.101], size: [0.03, 0.018, 0.012], label: 'probe', labelAt: [0, -0.016, 0.002], action: of('probe') },
    { id: 'power', at: [0.135, 0.03, 0.101], size: [0.026, 0.018, 0.012], label: 'power', labelAt: [0, -0.016, 0.002], action: of('power') },
  ],
  generic: [],
};

export const controlsOf = (kind: string): readonly ControlSpec[] => CONTROLS[kind] ?? [];

/** The action a control (or one half of a knob) sends. */
export function actionOf(spec: ControlSpec, st: Readonly<ItemState>, half?: -1 | 1): LabAction | null {
  if (spec.knob) return { type: spec.knob, value: half ?? 1 };
  return spec.action ? spec.action(st) : null;
}
