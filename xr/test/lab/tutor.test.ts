import { describe, expect, it } from 'vitest';
import { createLabStore } from '../../src/lab/model/store';
import { createRunner } from '../../src/lab/experiments/runner';
import { FLAME_TEST } from '../../src/lab/experiments/chemistry';
import { createTutor, ESCALATE_MS, HINT_MS, REPEAT_MS, type TutorEvent } from '../../src/lab/tutor/tutor';
import { createTutorFeed, SNAPSHOT_SCHEMA } from '../../src/lab/tutor/feed';
import { driveFlameTest, idOf, wait } from './drive';

const setup = () => {
  const store = createLabStore();
  const runner = createRunner(store);
  const tutor = createTutor(store, runner);
  const events: TutorEvent[] = [];
  tutor.subscribe((e) => events.push(e));
  return { store, runner, tutor, events, tick: () => tutor.tick() };
};

describe('lab tutor', () => {
  it('gas on and unlit: a warning at 2 s, a hazard once it has lasted 5 s more, no repeat every frame', () => {
    const { store, events, tick } = setup();
    const id = store.place('bunsen-burner', { x: 0, z: 0, yaw: 0 });
    store.apply(id, { type: 'gas' });
    wait(store, 2500, tick);
    const warn = events.filter((e) => e.mistakeId === 'gas-unlit');
    expect(warn).toHaveLength(1);
    expect(warn[0]).toMatchObject({ kind: 'warn', equipmentId: id, itemKind: 'bunsen-burner' });
    expect(warn[0]!.text.de).toContain('Gashahn');
    wait(store, ESCALATE_MS, tick);
    const all = events.filter((e) => e.mistakeId === 'gas-unlit');
    expect(all.map((e) => e.kind)).toEqual(['warn', 'hazard']);
    wait(store, REPEAT_MS + 200, tick);
    expect(events.filter((e) => e.mistakeId === 'gas-unlit')).toHaveLength(3);
    store.apply(id, { type: 'gas' });
    wait(store, 300, tick);
    expect(events.at(-1)).toMatchObject({ kind: 'praise', mistakeId: 'gas-unlit' });
  });

  it('a refused action is a warning with its reason, in six languages', () => {
    const { store, events } = setup();
    const id = store.place('bunsen-burner', { x: 0, z: 0, yaw: 0 });
    store.apply(id, { type: 'light' });
    expect(events.at(-1)).toMatchObject({ kind: 'warn', equipmentId: id });
    expect(events.at(-1)!.text.zh).toBe('没有燃气：先打开燃气阀');
  });

  it('practice: instructs each step, praises it, and hints when stuck', () => {
    const { store, runner, events, tick } = setup();
    runner.start(FLAME_TEST, { seed: 2 });
    expect(events[0]).toMatchObject({ kind: 'instruct', stepId: 'light', experimentId: FLAME_TEST.id, itemKind: 'bunsen-burner' });
    wait(store, HINT_MS + 300, tick);
    expect(events.some((e) => e.kind === 'hint' && e.stepId === 'light')).toBe(true);
    driveFlameTest(store, runner, tick);
    expect(events.filter((e) => e.kind === 'instruct').map((e) => e.stepId)).toEqual(FLAME_TEST.steps.map((s) => s.id));
    expect(events.at(-1)!.text.en).toContain('Score: 100');
  });

  it('exam: quiet except for hazards', () => {
    const { store, runner, events, tick } = setup();
    runner.start(FLAME_TEST, { mode: 'exam', seed: 2 });
    const burner = idOf(store, 'bunsen-burner');
    store.apply(burner, { type: 'light' });
    store.apply(burner, { type: 'gas' });
    wait(store, 2000 + ESCALATE_MS + 500, tick);
    const kinds = events.map((e) => e.kind);
    expect(kinds[0]).toBe('instruct'); // the exam's one opening line
    expect(kinds.slice(1)).toEqual(['hazard']);
  });

  it('the feed snapshot is compact JSON with the step, items, mistakes and notes', () => {
    const { store, runner, tutor, tick } = setup();
    runner.start(FLAME_TEST, { seed: 2 });
    store.apply(idOf(store, 'bunsen-burner'), { type: 'gas' });
    wait(store, 2500, tick);
    const feed = createTutorFeed(store, runner, tutor, () => 'fr');
    const snap = feed.snapshot();
    expect(snap.schema).toBe(SNAPSHOT_SCHEMA);
    expect(snap.lang).toBe('fr');
    expect(snap.lab).toEqual({ id: 'chemistry', name: 'Labo de chimie' });
    expect(snap.experiment).toMatchObject({ id: FLAME_TEST.id, mode: 'practice', step: { id: 'light', index: 0, of: 7 } });
    expect(snap.items.map((i) => i.kind)).toEqual(['bunsen-burner', 'flame-test-kit']);
    expect(snap.items[0]!.report).toMatchObject({ gasOn: true, lit: false });
    expect(snap.mistakes).toEqual([expect.objectContaining({ kind: 'bunsen-burner', mistakeId: 'gas-unlit', severity: 'escalate' })]);
    expect(Object.keys(snap.notes)).toEqual(['bunsen-burner', 'flame-test-kit']);
    expect(snap.notes['bunsen-burner']!.mistakes['gas-unlit']!.when).toContain('2 seconds');
    const json = JSON.stringify(snap);
    expect(JSON.parse(json)).toEqual(snap);
    expect(json.length).toBeLessThan(12_000);
  });
});
