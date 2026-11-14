import { describe, expect, it } from 'vitest';
import { LAB_TEMPLATES, TEMPLATES, loadTemplate } from '@content/projects';
import { validateValue } from '@/project/validate';
import type { Project } from '../../src/contracts/project';
import { emptyBench } from '../../src/assistant/empty';
import { netPartition, planBuild, tryOps } from '../../src/assistant/planner';
import { countingIds, createRecipes, idsIn } from '../../src/assistant/recipes';
import { createProjectStore } from '../../src/project/store';

const recipesFor = (doc: () => Project) => createRecipes({ ids: countingIds(() => idsIn(doc())) });

/** Applies every step through a real project store, one apply (one undo entry) per step. */
function build(start: Project, target: Project) {
  const store = createProjectStore(start);
  const plan = planBuild(store.doc, target, { lang: 'en', recipes: recipesFor(() => store.doc) });
  for (const step of plan.steps) {
    const res = store.apply(step.ops, { label: step.label });
    if (!res.ok) throw new Error(`${step.key}: ${res.message}`);
  }
  return { store, plan };
}

const sortNets = (doc: Project) =>
  doc.nets
    .map((n) => ({ ...n, connections: [...n.connections].sort((a, b) => `${a.c}.${a.p}`.localeCompare(`${b.c}.${b.p}`)) }))
    .sort((a, b) => a.id.localeCompare(b.id));

/** JSON with sorted keys, so two documents compare by content and not by the order a handler wrote fields in. */
const canon = (x: unknown): string =>
  JSON.stringify(x, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );

const benchOf = (doc: Project) => doc.views.find((v) => v.kind === 'breadboard')!;

describe('the scripted planner', () => {
  it('builds Uno Blink on an empty bench in the order a person would', async () => {
    const target = await loadTemplate('prj_uno-r3-blink');
    const empty = emptyBench(target);
    expect(benchOf(empty).placements).toEqual([]);
    expect(empty.nets).toEqual([]);

    const { store, plan } = build(empty, target);
    expect(plan.unreachable).toEqual([]);
    expect(plan.steps.map((s) => s.key)).toEqual([
      'place:brd_main',
      'place:cmp_bb',
      'place:cmp_led1',
      'place:cmp_res1',
      'wire:wir_1',
      'wire:wir_2',
    ]);
    expect(plan.steps.map((s) => s.label)).toEqual(['Place U1', 'Place BB1', 'Place LED1', 'Place RES1', 'Wire U1.D13 to a10', 'Wire U1.GND to a15']);
    for (const s of plan.steps) expect(s.reason.length).toBeGreaterThan(0);

    // The target's nets, with its ids, names and classes.
    expect(netPartition(store.doc)).toEqual(netPartition(target));
    expect(sortNets(store.doc)).toEqual(sortNets(target));
    // The same placements and wires.
    expect(benchOf(store.doc).placements).toEqual(benchOf(target).placements);
    expect(benchOf(store.doc).wires).toEqual(benchOf(target).wires);
    expect(validateValue(store.doc).ok).toBe(true);
  });

  it('plans nothing more on a bench that is already built', async () => {
    const target = await loadTemplate('prj_uno-r3-blink');
    const plan = planBuild(target, target, { lang: 'en', recipes: createRecipes() });
    expect(plan.steps).toEqual([]);
    expect(plan.unreachable).toEqual([]);
  });

  it('every step is one valid batch against the bench the steps before it leave', async () => {
    const target = await loadTemplate('prj_uno-r3-blink');
    let doc = emptyBench(target);
    const plan = planBuild(doc, target, { lang: 'en', recipes: createRecipes() });
    for (const step of plan.steps) {
      const res = tryOps(doc, step.ops);
      expect(res.ok, step.key).toBe(true);
      if (res.ok) doc = res.state;
    }
  });

  it('leaves out declined steps and the steps that need them', async () => {
    const target = await loadTemplate('prj_uno-r3-blink');
    const plan = planBuild(emptyBench(target), target, { lang: 'en', recipes: createRecipes(), declined: ['place:cmp_res1'] });
    expect(plan.steps.map((s) => s.key)).toEqual(['place:brd_main', 'place:cmp_bb', 'place:cmp_led1', 'wire:wir_1', 'wire:wir_2']);
    const noBoard = planBuild(emptyBench(target), target, { lang: 'en', recipes: createRecipes(), declined: ['place:brd_main'] });
    expect(noBoard.steps.map((s) => s.key)).toEqual(['place:cmp_bb', 'place:cmp_led1', 'place:cmp_res1']);
    expect(noBoard.unreachable.map((u) => u.key)).toEqual(['wire:wir_1', 'wire:wir_2']);
  });

  it('says its reasons and labels in the snapshot language', async () => {
    const target = await loadTemplate('prj_uno-r3-blink');
    const plan = planBuild(emptyBench(target), target, { lang: 'de', recipes: createRecipes() });
    expect(plan.steps[0]!.label).toBe('U1 platzieren');
    expect(plan.steps[2]!.reason).toContain('c14, c15');
  });

  it('rebuilds every template with a breadboard circuit: same nets, placements and wires', async () => {
    const failures: string[] = [];
    let built = 0;
    for (const entry of [...TEMPLATES, ...LAB_TEMPLATES]) {
      const target = validateValue(await entry.load()).doc;
      if (!target) continue;
      const view = benchOf(target);
      if (!view?.surface) continue;
      try {
        const { store, plan } = build(emptyBench(target), target);
        const got = benchOf(store.doc);
        const problems = [
          canon(netPartition(store.doc)) !== canon(netPartition(target)) && 'nets differ',
          canon(sortNets(store.doc)) !== canon(sortNets(target)) && 'net ids, names or classes differ',
          canon(got.placements) !== canon(view.placements) && 'placements differ',
          canon(got.wires) !== canon(view.wires) && 'wires differ',
          ...plan.unreachable.map((u) => `${u.key} ${u.why}`),
        ].filter(Boolean);
        if (problems.length > 0) failures.push(`${entry.id}: ${problems.join('; ')}`);
        else built++;
      } catch (err) {
        failures.push(`${entry.id}: ${(err as Error).message}`);
      }
    }
    console.info(`built ${built}; failed ${failures.length}`);
    expect(failures).toEqual([]);
  });
});
