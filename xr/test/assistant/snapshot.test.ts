import { describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import { snapshotOf, SOURCE_CHARS } from '../../src/assistant/snapshot';
import { emptyBench } from '../../src/assistant/empty';
import type { LessonGuideState } from '../../src/contracts/lesson';
import type { Finding } from '../../src/contracts/sim';

const guide: LessonGuideState = {
  lessonId: 'board:uno-r3/blink',
  title: { en: 'Blink an LED', de: 'Eine LED blinken lassen' },
  lang: 'de',
  steps: [
    { id: 's1', text: { en: 'Seat the LED' }, status: 'done', highlights: [] },
    { id: 's2', text: { en: 'Seat the resistor', de: 'Setze den Widerstand' }, status: 'current', highlights: [] },
  ],
  current: 1,
  callouts: [],
  checks: { status: 'idle', results: [] },
  done: false,
};

const finding = {
  ruleId: 'led-no-resistor',
  causeId: 'led-no-resistor',
  symptomId: 'led-burnt',
  severity: 'error',
  targets: [
    { kind: 'part', id: 'cmp_led1' },
    { kind: 'pin', id: 'brd_main', pin: 'D13' },
  ],
  evidence: [],
  messageKey: 'ledNoResistor',
  args: { part: 'LED1' },
} as unknown as Finding;

describe('the bench snapshot', () => {
  it('is plain JSON a model can be sent, with the document summary, selection, run, findings and lesson step', async () => {
    const doc = await loadTemplate('prj_uno-r3-blink');
    const snap = snapshotOf({ doc, lang: 'de', selection: ['cmp_led1'], run: 'running', atNs: 1_500_000_000, findings: [finding], guide });
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    expect(snap.v).toBe(1);
    expect(snap.selection).toEqual(['cmp_led1']);
    expect(snap.run).toEqual({ state: 'running', atMs: 1500 });
    expect(snap.findings).toEqual([
      { rule: 'led-no-resistor', severity: 'error', key: 'ledNoResistor', args: { part: 'LED1' }, targets: ['part:cmp_led1', 'pin:brd_main.D13'] },
    ]);
    expect(snap.lesson).toEqual({ lessonId: 'board:uno-r3/blink', title: 'Eine LED blinken lassen', step: 1, steps: 2, text: 'Setze den Widerstand', done: false });

    const led = snap.project.parts.find((p) => p.id === 'cmp_led1');
    expect(led).toEqual({
      id: 'cmp_led1',
      refdes: 'LED1',
      kind: 'component',
      def: 'core.led-5mm@1.0.0',
      params: { color: 'red' },
      at: { xMm: 0, yMm: 0, rotationDeg: 0, legs: { A: 'c14', K: 'c15' } },
    });
    expect(snap.project.surface).toBe('cmp_bb');
    expect(snap.project.nets.find((n) => n.id === 'net_d13')).toEqual({ id: 'net_d13', name: 'D13', class: 'signal', pins: ['brd_main.D13', 'cmp_res1.P1'] });
    expect(snap.project.wires).toContainEqual({ id: 'wir_1', from: 'brd_main.D13', to: 'cmp_bb.a10', net: 'net_d13', color: 'orange' });
    expect(snap.project.sources[0]!.text).toContain('digitalWrite');
  });

  it('is compact: no history, no dependency interfaces, source text capped', async () => {
    const doc = await loadTemplate('prj_uno-r3-blink');
    const big = { ...doc, sources: doc.sources.map((s) => ({ ...s, content: 'x'.repeat(SOURCE_CHARS * 3) })) };
    const snap = snapshotOf({ doc: big, lang: 'en' });
    expect(snap.project.sources[0]!.truncated).toBe(true);
    expect(snap.project.sources[0]!.text.length).toBe(SOURCE_CHARS);
    const size = JSON.stringify(snapshotOf({ doc, lang: 'en' })).length;
    expect(size).toBeLessThan(4000);
    expect(JSON.stringify(doc).length).toBeGreaterThan(size * 5);
  });

  it('shows an empty bench as parts in the project with no place on the bench', async () => {
    const snap = snapshotOf({ doc: emptyBench(await loadTemplate('prj_uno-r3-blink')), lang: 'en' });
    expect(snap.project.parts.map((p) => [p.id, p.at])).toEqual([
      ['brd_main', undefined],
      ['cmp_bb', undefined],
    ]);
    expect(snap.project.nets).toEqual([]);
    expect(snap.project.wires).toEqual([]);
    expect(snap.run).toEqual({ state: 'unloaded', atMs: null });
    expect(snap.lesson).toBeNull();
  });
});
