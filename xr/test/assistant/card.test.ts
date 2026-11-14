import { describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import type { BuildPlan, CoBuildState, PlanStep } from '../../src/contracts/assistant';
import { cardModel } from '../../src/assistant/card';
import { DEFAULT_TEMPLATE, menuTarget } from '../../src/assistant/index';
import { emptyBench } from '../../src/assistant/empty';

const step = (key: string, label: string, reason = `${label} because`): PlanStep => ({ key, kind: 'place', ops: [], reason, label, anchors: [], needs: [] });
const plan: BuildPlan = {
  id: 'prp_test',
  baseRevision: 0,
  summary: "Let's build Blink an LED",
  steps: [step('place:a', 'Place U1'), step('place:b', 'Place BB1'), step('place:c', 'Place LED1')],
  unreachable: [],
};
const base: CoBuildState = { status: 'thinking', actor: 'usr_cobuilder', plan: null, current: null, performed: [], declined: [], auto: false };
const enabled = (s: CoBuildState) =>
  Object.entries(cardModel(s, 'en').buttons)
    .filter(([, b]) => b.enabled)
    .map(([k]) => k);

describe('the proposal card', () => {
  it('while thinking: only Stop', () => {
    const m = cardModel(base, 'en');
    expect(m.body).toBe('Thinking about the next step');
    expect(enabled(base)).toEqual(['stop']);
  });

  it('while proposing: the step, its reason, where the build is, and every answer but Undo before anything is done', () => {
    const s: CoBuildState = { ...base, status: 'proposing', plan, current: plan.steps[0]! };
    const m = cardModel(s, 'en');
    expect([m.kicker, m.title, m.body, m.progress]).toEqual(['Helper', 'Place U1', 'Place U1 because', 'Step 1 of 3']);
    expect(m.buttons.accept.primary).toBe(true);
    expect(enabled(s)).toEqual(['accept', 'acceptAll', 'reject', 'stop']);
  });

  it('counts what was done and what is left after a re-plan', () => {
    const later: BuildPlan = { ...plan, steps: plan.steps.slice(1) };
    const s: CoBuildState = { ...base, status: 'proposing', plan: later, current: later.steps[0]!, performed: [{ key: 'place:a', label: 'Place U1', revision: 1 }] };
    expect(cardModel(s, 'en').progress).toBe('Step 2 of 3');
    expect(enabled(s)).toContain('undo');
  });

  it('while performing: nothing to answer but Stop, unless accept-all runs (Skip and Undo then stop the run)', () => {
    const s: CoBuildState = { ...base, status: 'performing', plan, current: plan.steps[0]! };
    expect(cardModel(s, 'en').body).toBe('Doing it: Place U1');
    expect(enabled(s)).toEqual(['stop']);
    const auto = { ...s, auto: true };
    expect(enabled(auto)).toEqual(['reject', 'undo', 'stop']);
    expect(cardModel(auto, 'en').buttons.acceptAll.active).toBe(true);
  });

  it('when done: the message, Undo and Close', () => {
    const s: CoBuildState = { ...base, status: 'done', plan, performed: [{ key: 'place:a', label: 'Place U1', revision: 1 }], message: 'Done. Everything is on the bench.' };
    const m = cardModel(s, 'en');
    expect([m.title, m.body]).toEqual(["Let's build Blink an LED", 'Done. Everything is on the bench.']);
    expect(m.buttons.stop.label).toBe('Close');
    expect(enabled(s)).toEqual(['undo', 'stop']);
  });

  it('speaks the person language', () => {
    const s: CoBuildState = { ...base, status: 'proposing', plan, current: plan.steps[0]! };
    const m = cardModel(s, 'de');
    expect(m.buttons.accept.label).toBe('Annehmen');
    expect(m.progress).toBe('Schritt 1 von 3');
  });
});

describe('Build it with me from the menu', () => {
  it('rebuilds the open project, or Uno Blink when the bench is empty', async () => {
    const doc = await loadTemplate('prj_uno-r3-blink');
    expect(menuTarget(doc)).toBe(doc);
    expect(menuTarget(emptyBench(doc))).toBe(DEFAULT_TEMPLATE);
  });
});
