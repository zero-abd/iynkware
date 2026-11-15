import { describe, expect, it } from 'vitest';
import { fill, l6, l6Count, l6Problems, same } from '../../src/lab/text';
import { FLAME_COLOUR_NAMES, LAB_NAMES, NOTES, REFUSALS, SALT_NAMES } from '../../src/lab/model/catalogue';
import { KINDS, MODELS } from '../../src/lab/model/registry';
import { EXPERIMENTS } from '../../src/lab/experiments/list';
import { TUTOR } from '../../src/lab/tutor/strings';
import { LAB_UI } from '../../src/lab/kit/strings';
import { CONTROL_LABELS } from '../../src/lab/items/labels';

/** Every refusal reason a model can give, found by reading the models' sources would be brittle: list them here. */
const REASONS = [
  'beaker-full', 'flask-full', 'flask-empty', 'no-gas', 'already-lit', 'unknown-param', 'bad-value', 'unknown-action', 'no-item', 'no-burner',
  'meter-off', 'calibrate-in-buffer', 'no-sample', 'output-off', 'no-current', 'stop-first', 'too-few-swings', 'mystery-locked', 'scope-off',
  'no-signal', 'no-generator',
];

describe('lab strings in six languages', () => {
  it.each([
    ['notes', NOTES],
    ['refusals', REFUSALS],
    ['labs', LAB_NAMES],
    ['salts', SALT_NAMES],
    ['flame colours', FLAME_COLOUR_NAMES],
    ['experiments', EXPERIMENTS],
    ['tutor', TUTOR],
    ['ui', LAB_UI],
    ['controls', CONTROL_LABELS],
  ] as const)('%s: no missing language, no placeholder mismatch', (_name, table) => {
    expect(l6Count(table)).toBeGreaterThan(0);
    expect(l6Problems(table)).toEqual([]);
  });

  it('translations are translations: most strings differ from English', () => {
    let differ = 0;
    let total = 0;
    const walk = (v: unknown) => {
      if (v && typeof v === 'object' && 'en' in v && 'de' in v) {
        const t = v as Record<string, string>;
        total++;
        if (t.de !== t.en && t.zh !== t.en && t.hi !== t.en) differ++;
      } else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk([NOTES, REFUSALS, EXPERIMENTS, TUTOR, LAB_UI]);
    expect(differ / total).toBeGreaterThan(0.85);
  });

  it('every kind has notes and every mistake a say-text', () => {
    for (const kind of KINDS) {
      expect(NOTES[kind], kind).toBeDefined();
      for (const m of MODELS[kind]!.mistakes) expect(NOTES[kind]!.mistakes[m], `${kind}/${m}`).toBeDefined();
    }
    for (const r of REASONS) expect(REFUSALS[r], r).toBeDefined();
  });

  it('fill takes each language of an L6 value', () => {
    const t = fill(l6('A {x}', 'B {x}', 'C {x}', 'D {x}', 'E {x}', 'F {x}'), { x: l6('1', '2', '3', '4', '5', '6') });
    expect(t).toEqual({ en: 'A 1', de: 'B 2', es: 'C 3', fr: 'D 4', hi: 'E 5', zh: 'F 6' });
    expect(fill(same('{n} Ω'), { n: 47 }).hi).toBe('47 Ω');
  });

  it('says free, never open source', () => {
    const json = JSON.stringify([NOTES, REFUSALS, EXPERIMENTS, TUTOR, LAB_UI, CONTROL_LABELS]).toLowerCase();
    expect(json).not.toContain('open source');
  });
});
