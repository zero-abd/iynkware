/**
 * The fault lab's deck on the Blink template: the cards the run acts on, inject and take back as one op each, Reset
 * faults in one batch, and a dead part, a short and an open leg each keeping the LED dark in a run.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import { getAppRegistry } from '@/parts/builtin';
import type { Project } from '@/project/generated/types';
import { validateValue } from '@/project/validate';
import { createProjectStore } from '../src/project/store';
import { activeOf, choicesFor, deckOf, injectOps, resetOps, takeBackOps, type Card } from '../src/run/faults/deck';
import { cardTitle } from '../src/run/faults';
import { createSimBridge, inlinePort } from '../src/sim/bridge';

let doc: Project;
beforeAll(async () => {
  const report = validateValue(await loadTemplate('prj_uno-r3-blink'));
  if (!report.ok || !report.doc) throw new Error('the Blink template did not load');
  doc = report.doc;
});

const find = (cards: Card[], kind: Card['kind'], part: string) => {
  const c = cards.find((x) => x.kind === kind && x.part === part);
  if (!c) throw new Error(`no ${kind} on ${part}: ${cards.map((x) => `${x.kind}@${x.part}`).join(', ')}`);
  return c;
};

async function ledLit(d: Project): Promise<boolean[]> {
  const b = createSimBridge({ port: inlinePort({ wallMs: () => 0, schedule: () => undefined }) });
  expect((await b.load(d)).ok).toBe(true);
  const out: boolean[] = [];
  await b.step(100);
  for (let i = 0; i < 3; i++) {
    const s = b.lastFrame?.parts.get('cmp_led1');
    out.push(s?.kind === 'led' && s.lit);
    await b.step(500);
  }
  await b.dispose();
  return out;
}

describe('the fault deck', () => {
  it('offers dead part, short, open leg, reversed LED, wrong value and wrong pin on Blink', () => {
    const cards = deckOf(doc, getAppRegistry());
    const want = [
      ['missing-part', 'cmp_led1'],
      ['short', 'cmp_led1'],
      ['open-wire', 'cmp_led1'],
      ['reversed-part', 'cmp_led1'],
      ['wrong-value', 'cmp_res1'],
      ['config', 'brd_main'],
    ] as const;
    for (const [kind, part] of want) find(cards, kind, part);
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
    expect(cardTitle(find(cards, 'missing-part', 'cmp_led1'), 'de')).toBe('Bauteil tot');
  });

  it('injects as one op, takes back, resets, and leaves held faults out of the deck', () => {
    const store = createProjectStore(doc);
    const cards = deckOf(doc, getAppRegistry());
    const dead = find(cards, 'missing-part', 'cmp_led1');
    const short = find(cards, 'short', 'cmp_res1');
    expect(injectOps(store.doc, dead)).toHaveLength(1);
    expect(store.apply(injectOps(store.doc, dead)!).ok).toBe(true);
    expect(store.apply(injectOps(store.doc, short)!).ok).toBe(true);
    expect(activeOf(store.doc).map((f) => f.id)).toEqual([dead.id, short.id]);
    expect(deckOf(store.doc, getAppRegistry()).some((c) => c.id === dead.id)).toBe(false);
    expect(store.apply(takeBackOps(store.doc, dead.id)).ok).toBe(true);
    expect(activeOf(store.doc).map((f) => f.id)).toEqual([short.id]);
    expect(store.apply(resetOps(store.doc)).ok).toBe(true);
    expect(activeOf(store.doc)).toEqual([]);
  });

  it('a dead LED, a shorted LED and an open leg each keep the LED dark; no fault blinks', async () => {
    const cards = deckOf(doc, getAppRegistry());
    expect(await ledLit(doc)).toEqual([true, false, true]);
    for (const kind of ['missing-part', 'short', 'open-wire'] as const) {
      const store = createProjectStore(doc);
      store.apply(injectOps(store.doc, find(cards, kind, 'cmp_led1'))!);
      expect(await ledLit(store.doc), kind).toEqual([false, false, false]);
    }
  });

  it('mystery choices hold the answer and two others, in a fixed order per fault', () => {
    const cards = deckOf(doc, getAppRegistry());
    const a = choicesFor('led-reversed', 'flt_x', cards);
    expect(a).toHaveLength(3);
    expect(a).toContain('led-reversed');
    expect(choicesFor('led-reversed', 'flt_x', cards)).toEqual(a);
  });
});
