/**
 * What the drone bench shows, as pure data: each part plate's state, which bench actions are on offer, the motors'
 * phase leads, how the part plates are laid out, and how serious a message is. No three.js, so it is unit tested.
 */
import type { BenchCraft, BenchMessage, BenchState, EngineTest } from '../model';

export type PartPlateState = 'on' | 'next' | 'waiting';

export interface PartView {
  readonly id: string;
  readonly state: PartPlateState;
  /** On the wrong way round (orientation 1). */
  readonly turned: boolean;
  /** Offers fitting it turned round too. */
  readonly polar: boolean;
}

export interface ActionView {
  /** The craft has this action at all (a Crazyflie has no smoke stopper). */
  readonly available: boolean;
  /** The test has passed (or, for the battery, it is plugged in). */
  readonly done: boolean;
}

export interface LeadView {
  readonly motor: string;
  readonly crossed: boolean;
}

export interface BenchView {
  readonly parts: readonly PartView[];
  readonly build: ActionView;
  readonly strip: ActionView;
  readonly plug: ActionView;
  readonly smoke: ActionView;
  readonly motors: ActionView;
  readonly calibrate: ActionView;
  /** Phase leads, shown while the motor wires are on. */
  readonly leads: readonly LeadView[];
}

const has = (st: BenchState, id: string) => Object.hasOwn(st.placed, id);

export function benchView(craft: BenchCraft, st: BenchState): BenchView {
  const next = craft.parts.find((p) => !has(st, p.id))?.id ?? null;
  const parts = craft.parts.map<PartView>((p) => ({
    id: p.id,
    state: has(st, p.id) ? 'on' : p.id === next ? 'next' : 'waiting',
    turned: has(st, p.id) && st.placed[p.id] === 1,
    polar: p.polar,
  }));
  const test = (t: EngineTest, done: boolean): ActionView => ({ available: craft.tests[t] !== undefined, done });
  const fitted = craft.parts.some((p) => has(st, p.id));
  const hasFc = craft.parts.some((p) => p.id === 'FC');
  const wires = craft.parts.some((p) => p.id === 'WIRES');
  return {
    parts,
    build: { available: true, done: false },
    strip: { available: fitted, done: false },
    plug: test('plug', st.plugged),
    smoke: test('smoke', st.smokeOk),
    motors: test('motors', st.motorOk && craft.motors.length > 0),
    calibrate: { available: craft.tests.calibrate !== undefined && hasFc, done: st.accOk },
    leads: wires && has(st, 'WIRES') ? craft.motors.map((m) => ({ motor: m.id, crossed: st.crossed.includes(m.id) })) : [],
  };
}

/** Messages that refuse or report a fault (a red tone); every other thing the bench says is a pass. */
export const FAIL_KEYS: ReadonlySet<string> = new Set([
  'live',
  'after',
  'propsLast',
  'takeOff',
  'notOn',
  'plugNeeds',
  'faultFix',
  'smokeNeeds',
  'motorNeeds',
  'propsOff',
  'needBatt',
  'calNeeds',
  'smokeShort',
  'pop',
  'noMotors',
  'busy',
]);

export type MessageTone = 'pass' | 'fail';

export const toneOf = (msg: Pick<BenchMessage, 'key'>): MessageTone => (FAIL_KEYS.has(msg.key) ? 'fail' : 'pass');

/** What the bench says last: the final `say` message, or null when it only logged. */
export function lastSay(messages: readonly BenchMessage[]): BenchMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.kind === 'say') return messages[i]!;
  return null;
}

export interface Cell {
  /** Centre of the cell, metres: x across (0 the middle), y up from the bench top. */
  readonly x: number;
  readonly y: number;
}

/**
 * Where the `n` part plates stand: rows of up to `perRow` in build order, left to right, top row first, the whole
 * block centred on x = 0 with its lowest row `base` metres above the bench.
 */
export function panelCells(n: number, perRow = 6, pitchX = 0.093, pitchY = 0.09, base = 0.07): Cell[] {
  const rows = Math.ceil(n / perRow);
  const out: Cell[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / perRow);
    const inRow = Math.min(perRow, n - r * perRow);
    const c = i - r * perRow;
    out.push({ x: (c - (inRow - 1) / 2) * pitchX, y: base + (rows - 1 - r) * pitchY });
  }
  return out;
}

/** One motor's turn in the motor test: it spins from `from` to `to` seconds; `wrong` marks the one found spinning the wrong way. */
export interface SpinStep {
  readonly motor: string;
  readonly from: number;
  readonly to: number;
  readonly rpm: number;
  readonly wrong: boolean;
}

export function motorSequence(craft: BenchCraft, wrong: readonly string[], seconds = 0.8, rpm = 6000): SpinStep[] {
  return craft.motors.map((m, i) => ({ motor: m.id, from: i * seconds, to: (i + 1) * seconds, rpm, wrong: wrong.includes(m.id) }));
}
