import { describe, expect, it } from 'vitest';
import { createLabStore } from '../../src/lab/model/store';
import { createRunner, scoreOf } from '../../src/lab/experiments/runner';
import { EXPERIMENTS, LAB_LAYOUTS } from '../../src/lab/experiments/list';
import { FLAME_TEST } from '../../src/lab/experiments/chemistry';
import { OHMS_LAW } from '../../src/lab/experiments/electrical';
import { PENDULUM } from '../../src/lab/experiments/physics';
import { MEASURE_WAVE } from '../../src/lab/experiments/signals';
import { PH_OF_A_LIQUID } from '../../src/lab/experiments/chemistry';
import { MODELS } from '../../src/lab/model/registry';
import { LAB_IDS } from '../../src/lab/model/types';
import { driveFlameTest, driveOhm, drivePendulum, drivePh, driveWave, idOf, wait } from './drive';

const setup = () => {
  const store = createLabStore();
  const runner = createRunner(store);
  return { store, runner };
};

describe('experiments', () => {
  it('every lab has at least one experiment and a layout of known kinds', () => {
    for (const lab of LAB_IDS) {
      expect(EXPERIMENTS.some((e) => e.lab === lab), lab).toBe(true);
      for (const k of LAB_LAYOUTS[lab]) expect(MODELS[k.kind], k.kind).toBeDefined();
    }
    for (const e of EXPERIMENTS) for (const k of e.kit) expect(MODELS[k.kind], `${e.id} ${k.kind}`).toBeDefined();
  });

  it.each([
    ['flame test', FLAME_TEST, (s: ReturnType<typeof setup>) => driveFlameTest(s.store, s.runner)],
    ['Ohm’s law', OHMS_LAW, (s: ReturnType<typeof setup>) => driveOhm(s.store)],
    ['pendulum', PENDULUM, (s: ReturnType<typeof setup>) => drivePendulum(s.store)],
    ['waveform', MEASURE_WAVE, (s: ReturnType<typeof setup>) => driveWave(s.store)],
    ['pH', PH_OF_A_LIQUID, (s: ReturnType<typeof setup>) => drivePh(s.store)],
  ] as const)('%s runs to completion with full marks when done right', (_name, exp, drive) => {
    for (const seed of [1, 2, 3, 42]) {
      const s = setup();
      const steps: string[] = [];
      s.runner.subscribe((e) => e.type === 'done' && steps.push(e.step.id));
      s.runner.start(exp, { mode: 'practice', seed });
      drive(s);
      const run = s.runner.state.value!;
      expect(run.done, `${exp.id} seed ${seed}: stuck at ${run.step?.id}`).toBe(true);
      expect(steps).toEqual(exp.steps.map((x) => x.id));
      const failed = run.result!.checks.filter((c) => !c.pass).map((c) => c.id);
      expect(failed, `${exp.id} seed ${seed}`).toEqual([]);
      expect(run.result!.score).toBe(100);
    }
  });

  it('the flame test’s unknown is seeded and a wrong answer fails its check', () => {
    const a = setup();
    a.runner.start(FLAME_TEST, { seed: 5 });
    const b = setup();
    b.runner.start(FLAME_TEST, { seed: 5 });
    expect(a.store.byKind('flame-test-kit')!.state.s.unknown).toBe(b.store.byKind('flame-test-kit')!.state.s.unknown);
    const unknown = a.store.byKind('flame-test-kit')!.state.s.unknown;
    driveFlameTest(a.store, a.runner, undefined, unknown === 'Na' ? 'K' : 'Na');
    const r = a.runner.state.value!.result!;
    expect(r.log.find((l) => l.type === 'answer')).toMatchObject({ key: 'salt', correct: false });
    expect(r.checks.find((c) => c.id === 'identified')!.pass).toBe(false);
  });

  it('exam: mistakes and refusals are logged with times and the step, and cost points', () => {
    const { store, runner } = setup();
    runner.start(FLAME_TEST, { mode: 'exam', seed: 9 });
    const burner = idOf(store, 'bunsen-burner');
    expect(store.apply(burner, { type: 'light' }).ok).toBe(false); // refused: no gas
    store.apply(burner, { type: 'gas' });
    wait(store, 3000); // gas-unlit
    store.apply(burner, { type: 'gas' });
    expect(runner.hint()).toBeNull();
    driveFlameTest(store, runner);
    const r = runner.state.value!.result!;
    expect(r.mode).toBe('exam');
    expect(r.completed).toBe(true);
    const mistake = r.log.find((l) => l.type === 'mistake');
    expect(mistake).toMatchObject({ type: 'mistake', mistakeId: 'gas-unlit', stepId: 'light' });
    expect(mistake!.at).toBeGreaterThanOrEqual(2000);
    expect(r.log.find((l) => l.type === 'refused')).toMatchObject({ reason: 'no-gas', stepId: 'light' });
    expect(r.checks.find((c) => c.id === 'safe-light')!.pass).toBe(false);
    expect(r.score).toBe(scoreOf(r.checks, 1, 1, 0, 'exam'));
    expect(r.score).toBe(80 - 5 - 2);
  });

  it('finish() early marks what is there', () => {
    const { runner } = setup();
    runner.start(PENDULUM, { mode: 'exam', seed: 1 });
    const r = runner.finish()!;
    expect(r.completed).toBe(false);
    expect(r.stepsDone).toBe(0);
    expect(r.score).toBeLessThan(100);
  });

  it('practice hints are counted', () => {
    const { runner } = setup();
    runner.start(OHMS_LAW, { seed: 1 });
    expect(runner.hint()).toEqual(OHMS_LAW.steps[0]!.hint);
    expect(runner.log.filter((l) => l.type === 'hint')).toHaveLength(1);
  });
});
