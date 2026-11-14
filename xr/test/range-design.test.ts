/** The design panel's logic: rows from the calculator, the checks and the arming rules; picks as ops with undo; the string table. */
import { describe, expect, it } from 'vitest';
import quad5 from '@/content/drones/quad5';
import { canArm } from '@/lib/dronelab/bench';
import { LANGS } from '../src/contracts/common';
import { createProjectStore, createTemplateSource } from '../src/project/store';
import { benchArmRules, benchCraft, benchOf, benchReport, designView, EMPTY_BENCH, pickOf, pickOp } from '../src/range/flight/model';
import { pickRow, PANEL, ROWS, shortLabel, toPanel } from '../src/range/flight/design/layout';
import { checkRows, checklistRows, designLines, num, stateOf, type Words } from '../src/range/flight/design/rows';
import { designStrings } from '../src/range/flight/design/strings';
import { sayOf } from '../src/range/flight/design/text';
import { stringProblems } from '../src/range/shared';
import dronelab from '../../src/i18n/messages/en/dronelab.json';

const say = sayOf(dronelab as Record<string, unknown>);
const words: Words = { say, own: (k, p) => designStrings.t('en', k, p) };
const craft = benchCraft('quad5')!;
const base = quad5.design.default;

describe('the design panel strings', () => {
  it('are complete in six languages', () => {
    expect(stringProblems(designStrings.table)).toEqual([]);
  });
});

describe('iynk strings the panel reads', () => {
  it('exist in all six languages (no row falls back to its key)', async () => {
    for (const lang of LANGS) {
      const messages = ((await import(`../../src/i18n/messages/${lang}/dronelab.json`)) as { default: Record<string, unknown> }).default;
      const w: Words = { say: sayOf(messages), own: (k, p) => designStrings.t(lang, k, p) };
      const view = designView(quad5, { ...base, motor: '2306-2450' });
      const rules = checklistRows(benchArmRules(quad5, benchReport(craft, EMPTY_BENCH), base), w.say);
      const texts = [
        ...designLines(view, w).flatMap((r) => [r.label, r.value]),
        ...checkRows(view, w).flatMap((r) => [r.tag, r.text]),
        ...rules.flatMap((r) => [r.text, r.word]),
        w.say('design.allGood'),
      ];
      for (const t of texts) expect(t, `${lang}: ${t}`).not.toMatch(/^[a-zA-Z-]+(\.[a-zA-Z-]+)+$/);
    }
  });
});

describe('designLines', () => {
  it('reads the calculator for the default pick', () => {
    const v = designView(quad5, base);
    const rows = designLines(v, words);
    expect(rows.map((r) => r.id)).toEqual(['auw', 'thrust', 'tw', 'hoverThr', 'maxA', 'hoverMin', 'flyMin', 'price']);
    expect(rows.find((r) => r.id === 'auw')!.value).toBe(`${num(v.weight, 0)} g`);
    expect(rows.find((r) => r.id === 'tw')!.value).toBe(`${num(v.thrustToWeight, 1)} : 1`);
    expect(rows.find((r) => r.id === 'price')!.value).toBe(`$${num(v.price!, 0)}`);
  });

  it('changes with the pick', () => {
    const a = designLines(designView(quad5, base), words);
    const b = designLines(designView(quad5, { ...base, motor: '2306-2450' }), words);
    expect(b.find((r) => r.id === 'maxA')!.value).not.toBe(a.find((r) => r.id === 'maxA')!.value);
  });
});

describe('checkRows', () => {
  it('says nothing for the default pick', () => {
    expect(checkRows(designView(quad5, base), words)).toEqual([]);
  });

  it('shows over-spin as a danger with iynk text for the 2306-2450 motor', () => {
    const rows = checkRows(designView(quad5, { ...base, motor: '2306-2450' }), words);
    const spin = rows.find((r) => r.code === 'over-spin');
    expect(spin).toMatchObject({ level: 'danger', tag: 'Problem' });
    expect(spin!.text).toContain('2450 KV on 6S');
  });

  it('puts the worst first and folds the rest into one row', () => {
    const view = designView(quad5, { ...base, motor: '2306-2450' });
    const fake = { ...view, checks: [...view.checks, { code: 'tail-heavy', level: 'warn' }, { code: 'short-flight', flyMin: 1, level: 'info' }, { code: 'weak', tw: 1, minTW: 5, level: 'danger' }] } as typeof view;
    const rows = checkRows(fake, words, 3);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.level).toBe('danger');
    expect(rows[2]!.code).toBe('more');
  });
});

describe('checklistRows', () => {
  it('shows an empty bench as built blocked', () => {
    const report = benchReport(craft, EMPTY_BENCH);
    const rules = benchArmRules(quad5, report, base);
    const rows = checklistRows(rules, say);
    const built = rows.find((r) => r.id === 'built')!;
    expect(built).toMatchObject({ state: 'blocked', icon: 'xCircle', text: 'Every part is fitted', word: 'blocks arming' });
    expect(rows.find((r) => r.id === 'throttle')!.state).toBe('ok');
    expect(canArm(rules)).toBe(false);
  });

  it('maps ok, block and warn levels to states and icons', () => {
    const rows = checklistRows(
      [
        { id: 'built', ok: true, level: 'block' },
        { id: 'smoke', ok: false, level: 'block' },
        { id: 'fcArrow', ok: false, level: 'warn' },
        { id: 'mistakes', ok: false, level: 'warn', code: 'x' },
      ],
      say,
    );
    expect(rows.map((r) => [r.state, r.icon])).toEqual([
      ['ok', 'checkCircle'],
      ['blocked', 'xCircle'],
      ['warn', 'warning'],
      ['warn', 'warning'],
    ]);
    expect(rows[3]!.text).toContain('x');
    expect(stateOf({ id: 'throttle', ok: true, level: 'rule' })).toBe('ok');
  });
});

describe('layout', () => {
  it('fits every pick row on the paper and keeps the rows apart', () => {
    for (const n of [1, 3, 4]) {
      const cells = pickRow(n, 0);
      expect(cells).toHaveLength(n);
      const last = cells[n - 1]!;
      expect(last.cx + last.w / 2).toBeLessThanOrEqual(PANEL.w - PANEL.margin + 1e-9);
      for (let i = 1; i < n; i++) expect(cells[i]!.cx - cells[i - 1]!.cx).toBeGreaterThan(cells[i]!.w);
    }
    expect(ROWS.rules + ROWS.rulePitch * (ROWS.ruleMax - 1)).toBeLessThan(ROWS.fly - 0.0225);
    expect(ROWS.checks + ROWS.checkBlock * ROWS.checkMax).toBeLessThanOrEqual(ROWS.rule2);
    expect(toPanel(PANEL.w / 2, PANEL.h / 2)).toEqual({ x: 0, y: 0 });
  });

  it('prints pack labels without the chemistry word', () => {
    expect(shortLabel('6S 1100 mAh LiPo')).toBe('6S 1100 mAh');
    expect(shortLabel('2306 1750KV')).toBe('2306 1750KV');
  });
});

describe('picking through the store', () => {
  it('applies one param.set op per pick, one undo each, and the numbers follow', async () => {
    const store = createProjectStore(await createTemplateSource().load('prj_drone-quad5'));
    const before = designLines(designView(quad5, pickOf(store.doc, quad5)), words);
    const op = pickOp(store.doc, 'motor', '2306-2450')!;
    expect(store.apply(op)).toMatchObject({ ok: true });
    expect(pickOp(store.doc, 'motor', '2306-2450')).toBeNull();
    const view = designView(quad5, pickOf(store.doc, quad5));
    expect(view.checks.map((c) => c.code)).toContain('over-spin');
    expect(designLines(view, words)).not.toEqual(before);
    store.apply(pickOp(store.doc, 'batt', '4s1500')!);
    store.undo();
    expect(pickOf(store.doc, quad5)).toMatchObject({ motor: '2306-2450', batt: base.batt });
    store.undo();
    expect(pickOf(store.doc, quad5)).toEqual(base);
    expect(benchOf(store.doc)).toEqual(EMPTY_BENCH);
  });
});
