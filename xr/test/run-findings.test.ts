import { beforeAll, describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import type { Project } from '@/project/generated/types';
import { validateValue } from '@/project/validate';
import { LANGS } from '../src/contracts/common';
import type { Finding } from '../src/contracts/sim';
import { createProjectStore } from '../src/project/store';
import { createSimBridge, inlinePort } from '../src/sim/bridge';
import { stringProblems } from '../src/run/kit/strings';
import { appliable, applyFix, fixDepsOf, fixesOf } from '../src/run/findings/fix';
import {
  CHECK_DEBOUNCE_MS,
  MAX_PINS,
  bySeverity,
  burntPin,
  createDebounce,
  findingId,
  mayCheck,
  mergePins,
  pinsOf,
  resolveTarget,
  stackSlots,
  toneOf,
  type Timers,
} from '../src/run/findings/static';
import { burntReason, findingAdvice, findingStrings, findingTitle, findingWhy, fixText } from '../src/run/findings/strings';

let doc: Project;
let bare: Project;
let findings: readonly Finding[];

beforeAll(async () => {
  const report = validateValue(await loadTemplate('prj_uno-r3-blink'));
  if (!report.ok || !report.doc) throw new Error('the Blink template did not load');
  doc = report.doc;
  const store = createProjectStore(doc);
  const applied = store.apply([
    { k: 'component.remove', id: 'cmp_res1' },
    { k: 'net.connect', net: 'net_d13', pin: { c: 'cmp_led1', p: 'A' }, move: true },
  ]);
  if (!applied.ok) throw new Error('the ops did not apply');
  bare = store.doc;
  const bridge = createSimBridge({ port: inlinePort({ wallMs: () => 0, schedule: () => undefined }) });
  findings = (await bridge.check(bare)).findings;
  await bridge.dispose();
});

const finding = (over: Partial<Finding> = {}): Finding => ({
  ruleId: 'r',
  causeId: 'led-no-series-resistor',
  symptomId: 's',
  severity: 'warning',
  targets: [{ kind: 'part', id: 'cmp_led1' }],
  evidence: [],
  messageKey: 'check.x',
  args: {},
  ...over,
});

describe('severity', () => {
  it('orders errors before warnings before notes', () => {
    const list = [{ severity: 'note' as const }, { severity: 'error' as const }, { severity: 'warning' as const }];
    expect(list.sort(bySeverity).map((s) => s.severity)).toEqual(['error', 'warning', 'note']);
  });
  it('maps to the callout tones', () => {
    expect([toneOf('error'), toneOf('warning'), toneOf('note')]).toEqual(['fail', 'warn', 'info']);
  });
});

describe('targets', () => {
  it('resolves a part, a pin and a net to a part of the document', () => {
    expect(resolveTarget(doc, { kind: 'part', id: 'cmp_led1' })).toEqual({ part: 'cmp_led1' });
    expect(resolveTarget(doc, { kind: 'pin', id: 'cmp_led1', pin: 'A' })).toEqual({ part: 'cmp_led1', pin: 'A' });
    expect(resolveTarget(doc, { kind: 'net', id: 'net_led1a_res1p2' })?.part).toBe('cmp_led1');
    expect(resolveTarget(doc, { kind: 'net', id: 'net_d13' })?.part).toBe('cmp_res1');
  });
  it('drops targets that are not in the document', () => {
    expect(resolveTarget(doc, { kind: 'part', id: 'cmp_gone' })).toBeNull();
    expect(resolveTarget(doc, { kind: 'net', id: 'nope' })).toBeNull();
    expect(resolveTarget(doc, { kind: 'wire', id: 'wir_gone' })).toBeNull();
    expect(resolveTarget(doc, { kind: 'hole', id: 'a1' })).toBeNull();
  });
  it('points a code finding at the board', () => {
    expect(resolveTarget(doc, { kind: 'file', id: 'main.ino' })).toEqual({ part: 'brd_main' });
  });
});

describe('pins', () => {
  it('turns the rules findings of a bare LED into a pin on the LED', () => {
    const pins = pinsOf(bare, findings, 'static');
    const led = pins.find((p) => p.finding?.causeId === 'led-no-series-resistor');
    expect(led?.place.part).toBe('cmp_led1');
    expect(led?.origin).toBe('static');
    expect(pinsOf(doc, [], 'static')).toEqual([]);
  });
  it('sorts by severity and leaves out findings that have no place', () => {
    const list = [
      finding({ ruleId: 'a', severity: 'note' }),
      finding({ ruleId: 'b', severity: 'error', targets: [{ kind: 'part', id: 'cmp_res1' }] }),
      finding({ ruleId: 'c', targets: [{ kind: 'part', id: 'cmp_gone' }] }),
    ];
    expect(pinsOf(doc, list, 'run').map((p) => p.id)).toEqual(['b:cmp_res1', 'a:cmp_led1']);
  });
  it('names the other parts of a finding', () => {
    const f = finding({ targets: [{ kind: 'part', id: 'cmp_led1' }, { kind: 'part', id: 'cmp_res1' }] });
    expect(pinsOf(doc, [f], 'static')[0]?.also).toEqual(['cmp_res1']);
  });
  it('gives a finding the same id every time', () => {
    const f = finding({ targets: [{ kind: 'pin', id: 'b', pin: '2' }, { kind: 'part', id: 'a' }] });
    expect(findingId(f)).toBe(findingId({ ...f, targets: [...f.targets].reverse() }));
  });
  it('lets a run finding replace the static one and puts a burnt part first', () => {
    const f = finding({ severity: 'error' });
    const s = pinsOf(doc, [f], 'static');
    const r = pinsOf(doc, [f], 'run');
    const burnt = burntPin(doc, 'cmp_res1', { key: 'fidelity.states.led', args: { name: 'RES1' } })!;
    const { shown } = mergePins(s, r, [burnt]);
    expect(shown.map((p) => p.origin)).toEqual(['burnt', 'run']);
  });
  it('shows one pin for the same cause on the same part, the run one', () => {
    const a = finding({ ruleId: 'rule:x' });
    const b = finding({ ruleId: 'solve:y' });
    const { shown } = mergePins(pinsOf(doc, [a], 'static'), pinsOf(doc, [b], 'run'));
    expect(shown.map((p) => p.origin)).toEqual(['run']);
  });
  it('names a burnt part by its refdes', () => {
    expect(burntPin(doc, 'cmp_led1', { key: 'fidelity.states.led', args: { name: 'cmp_led1' } })?.burnt?.why.args.name).toBe('LED1');
  });
  it('cuts the list at the most severe', () => {
    const many = Array.from({ length: MAX_PINS + 5 }, (_, i) => finding({ ruleId: `r${i}`, causeId: `c${i}`, severity: i === 3 ? 'error' : 'note' }));
    const { shown, hidden } = mergePins(pinsOf(doc, many, 'static'));
    expect(shown).toHaveLength(MAX_PINS);
    expect(hidden).toBe(5);
    expect(shown[0]?.severity).toBe('error');
  });
  it('stacks pins that share an anchor', () => {
    const list = pinsOf(doc, [finding({ ruleId: 'a' }), finding({ ruleId: 'b' }), finding({ ruleId: 'c', targets: [{ kind: 'part', id: 'cmp_res1' }] })], 'static');
    expect([...stackSlots(list).values()].sort()).toEqual([0, 0, 1]);
  });
  it('refuses a burnt pin for a part that is gone', () => {
    expect(burntPin(doc, 'cmp_gone', { key: 'fidelity.states.led', args: {} })).toBeNull();
  });
});

describe('debounce and gating', () => {
  function fake() {
    let now = 0;
    const jobs = new Map<number, { at: number; fn: () => void }>();
    let n = 0;
    const timers: Timers = {
      set: (fn, ms) => {
        jobs.set(++n, { at: now + ms, fn });
        return n;
      },
      clear: (h) => void jobs.delete(h as number),
    };
    const advance = (ms: number) => {
      now += ms;
      for (const [id, j] of [...jobs]) {
        if (j.at > now) continue;
        jobs.delete(id);
        j.fn();
      }
    };
    return { timers, advance };
  }
  it('runs once, a moment after the last change', () => {
    const t = fake();
    let runs = 0;
    const d = createDebounce(() => runs++, CHECK_DEBOUNCE_MS, t.timers);
    d.call();
    t.advance(300);
    d.call();
    t.advance(300);
    expect(runs).toBe(0);
    expect(d.pending).toBe(true);
    t.advance(100);
    expect(runs).toBe(1);
    expect(d.pending).toBe(false);
  });
  it('can be cancelled', () => {
    const t = fake();
    let runs = 0;
    const d = createDebounce(() => runs++, 400, t.timers);
    d.call();
    d.cancel();
    t.advance(1000);
    expect(runs).toBe(0);
  });
  it('checks everywhere but while running', () => {
    expect(['idle', 'paused', 'done', 'halted', 'limit', 'unloaded', 'error'].every(mayCheck)).toBe(true);
    expect(mayCheck('running')).toBe(false);
  });
});

describe('messages', () => {
  it('has the card words in six languages', () => {
    expect(stringProblems(findingStrings.table)).toEqual([]);
  });
  it('reads the title, why and advice of a cause in every language', () => {
    const f = finding();
    for (const lang of LANGS) {
      expect(findingTitle(lang, f).length).toBeGreaterThan(3);
      expect(findingWhy(lang, f).length).toBeGreaterThan(3);
      expect(findingAdvice(lang, f).length).toBeGreaterThan(3);
    }
    expect(findingTitle('en', f)).toBe('LED with no series resistor');
    expect(findingTitle('de', f)).not.toBe(findingTitle('en', f));
  });
  it('falls back to the message and then the rule id', () => {
    expect(findingTitle('en', finding({ causeId: 'x-none', messageKey: 'fix.led-series', args: { ohms: '330 Ω', led: 'LED1' } }))).toContain('330');
    expect(findingTitle('en', finding({ causeId: 'x-none', messageKey: 'check.nowhere', ruleId: 'my-rule' }))).toBe('my-rule');
  });
  it('fills a fix sentence in every language', () => {
    for (const lang of LANGS) {
      const text = fixText(lang, 'fix.led-series', { ohms: '330 Ω', led: 'LED1' });
      expect(text).toContain('330');
      expect(text).not.toContain('{');
    }
  });
  it('reads a burnt part reason from the fidelity texts in every language', () => {
    const why = { key: 'fidelity.states.led', args: { name: 'LED1', n: 120, imax: 20, limit: 50 } };
    for (const lang of LANGS) {
      const text = burntReason(lang, why);
      expect(text).toContain('LED1');
      expect(text).toContain('120');
      expect(text).not.toContain('{');
    }
  });
});

describe('fixes', () => {
  it('turns the series-resistor plan into ops and applies them as one undoable entry', () => {
    const store = createProjectStore(bare);
    const f = findings.find((x) => x.causeId === 'led-no-series-resistor');
    expect(f).toBeDefined();
    const fixes = fixesOf(store.doc, f!, fixDepsOf(store));
    const at = appliable(fixes);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(fixes[at]!.ops.length).toBeGreaterThan(0);
    const before = store.doc.components.length;
    const out = applyFix(store, f!, at, 'Fix: series resistor');
    expect(out.ok).toBe(true);
    expect(store.doc.components.length).toBe(before + 1);
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.doc.components.length).toBe(before);
  });
  it('reports a fix that no longer applies', () => {
    const store = createProjectStore(doc);
    const f = findings.find((x) => x.causeId === 'led-no-series-resistor')!;
    expect(applyFix(store, f, 0, 'x').ok).toBe(false);
  });
  it('has no fix to apply for a finding with none', () => {
    expect(appliable([])).toBe(-1);
    expect(fixesOf(doc, finding(), fixDepsOf(createProjectStore(doc)))).toEqual([]);
  });
});
