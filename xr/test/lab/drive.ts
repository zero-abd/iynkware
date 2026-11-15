/** Drives each experiment to completion through the store, as a person would, for the tests. */
import type { LabStore } from '../../src/lab/model/store';
import type { Runner } from '../../src/lab/experiments/runner';

export const idOf = (store: LabStore, kind: string): string => store.byKind(kind)!.id;
export const wait = (store: LabStore, ms: number, tick?: () => void): void => {
  for (let t = 0; t < ms; t += 50) {
    store.step(50);
    tick?.();
  }
};
const ok = (store: LabStore, kind: string, type: string, value?: number | string | boolean) => {
  const r = store.apply(idOf(store, kind), value === undefined ? { type } : { type, value });
  if (!r.ok) throw new Error(`${kind} ${type}: ${r.reason}`);
};

export function driveFlameTest(store: LabStore, runner: Runner, tick?: () => void, salt?: string): void {
  ok(store, 'bunsen-burner', 'gas');
  ok(store, 'bunsen-burner', 'light');
  ok(store, 'bunsen-burner', 'collar', 'half');
  ok(store, 'flame-test-kit', 'dip-acid');
  ok(store, 'flame-test-kit', 'to-flame');
  wait(store, 2000, tick);
  ok(store, 'flame-test-kit', 'dip-salt', 'unknown');
  ok(store, 'flame-test-kit', 'to-flame');
  wait(store, 1000, tick);
  const unknown = store.byKind('flame-test-kit')!.state.s.unknown as string;
  store.answer('salt', salt ?? unknown);
  ok(store, 'flame-test-kit', 'to-rack');
  ok(store, 'bunsen-burner', 'gas');
  void runner;
}

export function driveOhm(store: LabStore): void {
  for (let i = 0; i < 2; i++) ok(store, 'bench-power-supply', 'iSet', 1); // 0.1 -> 0.2 -> 0.5
  for (let i = 0; i < 3; i++) ok(store, 'bench-power-supply', 'vSet', 1); // 0 -> 1.5 -> 3.3 -> 5
  ok(store, 'bench-power-supply', 'power');
  ok(store, 'bench-power-supply', 'record');
  ok(store, 'bench-power-supply', 'vSet', 1); // 9 V
  ok(store, 'bench-power-supply', 'record');
  store.answer('ohms', store.byKind('bench-power-supply')!.state.s.ohms as number);
  for (let i = 0; i < 2; i++) ok(store, 'bench-power-supply', 'iSet', -1); // 0.1 A
  for (let i = 0; i < 4; i++) ok(store, 'bench-power-supply', 'vSet', 1); // 30 V
  ok(store, 'bench-power-supply', 'power');
}

export function drivePendulum(store: LabStore, tick?: () => void): void {
  ok(store, 'pendulum-stand', 'amplitude', 10);
  ok(store, 'pendulum-stand', 'swing');
  wait(store, 13_000, tick);
  ok(store, 'pendulum-stand', 'record');
  ok(store, 'pendulum-stand', 'swing');
  ok(store, 'pendulum-stand', 'length', 200);
  ok(store, 'pendulum-stand', 'swing');
  wait(store, 9500, tick);
  ok(store, 'pendulum-stand', 'record');
  store.answer('g', 9.8);
}

export function driveWave(store: LabStore): void {
  ok(store, 'function-generator', 'power');
  ok(store, 'oscilloscope', 'probe');
  ok(store, 'oscilloscope', 'power');
  const g = store.byKind('function-generator')!.state.p;
  const f = g.freq as number;
  const vpp = g.amp as number;
  // Timebase: the slowest setting that shows at most six periods; volts: the smallest that keeps it under 8 divisions.
  const TIME = [1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2];
  const VOLT = [0.1, 0.2, 0.5, 1, 2, 5];
  const tWant = [...TIME].reverse().find((t) => 10 * t * f <= 6 && 10 * t * f >= 1)!;
  const vWant = VOLT.find((v) => vpp / v <= 8 && vpp / v >= 2)!;
  const sc = () => store.byKind('oscilloscope')!.state.p;
  while (sc().timeDiv !== tWant) ok(store, 'oscilloscope', 'timeDiv', (sc().timeDiv as number) > tWant ? -1 : 1);
  while (sc().voltsDiv !== vWant) ok(store, 'oscilloscope', 'voltsDiv', (sc().voltsDiv as number) > vWant ? -1 : 1);
  ok(store, 'oscilloscope', 'measure');
  store.answer('vpp', vpp);
  store.answer('freq', f);
}

export function drivePh(store: LabStore): void {
  ok(store, 'ph-meter', 'power');
  ok(store, 'ph-meter', 'probe', 'buffer');
  ok(store, 'ph-meter', 'calibrate');
  ok(store, 'ph-meter', 'probe', 'rinse');
  ok(store, 'ph-meter', 'probe', 'sample');
  const r = store.report(idOf(store, 'ph-meter'))!.reading as number;
  store.answer('nature', r < 6.5 ? 'acidic' : r > 7.5 ? 'alkaline' : 'neutral');
  ok(store, 'ph-meter', 'probe', 'rinse');
  ok(store, 'ph-meter', 'probe', 'stored');
}
