/** The analog watch union (`mergeWatches`) and the bridge's per-owner watches reaching the worker as one union. */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import type { Project } from '@/project/generated/types';
import { validateValue } from '@/project/validate';
import type { SimReq } from '@/sim-host/protocol';
import type { AnalogWatch } from '../src/contracts/sim';
import { mergeWatches } from '../src/sim/analog';
import { createSimBridge, inlinePort, type SimPort } from '../src/sim/bridge';

const watch = (w: Partial<AnalogWatch>): AnalogWatch => ({ volts: [], amps: [], pinAmps: false, waves: [], ...w });

describe('mergeWatches', () => {
  it('is empty for no watches', () => {
    expect(mergeWatches([])).toEqual(watch({}));
  });

  it('unions every field: all wins, lists merge sorted, pinAmps if any asks', () => {
    expect(mergeWatches([watch({ volts: ['b'], amps: ['x'] }), watch({ volts: ['a', 'b'], pinAmps: true })])).toEqual(
      watch({ volts: ['a', 'b'], amps: ['x'], pinAmps: true }),
    );
    expect(mergeWatches([watch({ volts: ['a'] }), watch({ volts: 'all', amps: 'all' }), watch({ volts: ['z'], amps: ['q'] })])).toEqual(
      watch({ volts: 'all', amps: 'all' }),
    );
  });

  it('de-duplicates waveform ids', () => {
    expect(mergeWatches([watch({ waves: ['s1', 's2'] }), watch({ waves: ['s2', 's3'] })]).waves).toEqual(['s1', 's2', 's3']);
  });

  it('caps waveform ids at 8, earliest owners first', () => {
    const first = Array.from({ length: 5 }, (_, i) => `a${i}`);
    const second = Array.from({ length: 5 }, (_, i) => `b${i}`);
    const merged = mergeWatches([watch({ waves: first }), watch({ waves: second })]);
    expect(merged.waves).toEqual([...first, 'b0', 'b1', 'b2']);
  });
});

describe('the bridge merges owners', () => {
  let doc: Project;
  beforeAll(async () => {
    const report = validateValue(await loadTemplate('prj_uno-r3-blink'));
    if (!report.ok || !report.doc) throw new Error('the Blink template did not load');
    doc = report.doc;
  });

  function recorded() {
    const inner = inlinePort({ wallMs: () => 0, schedule: () => undefined });
    const sent: SimReq[] = [];
    const port: SimPort = { ...inner, call: (msg, o) => (sent.push(msg), inner.call(msg, o)) };
    const watches = () => sent.filter((m) => m.t === 'analog.watch').map((m) => (m as { watch: AnalogWatch }).watch);
    return { port, sent, watches };
  }

  it('sends the union of two owners, replaces by owner, and drops one', async () => {
    const { port, watches } = recorded();
    const bridge = createSimBridge({ port });
    await bridge.load(doc);
    await bridge.watchAnalog(watch({ volts: ['n1'] }), 'flow');
    await bridge.watchAnalog(watch({ waves: ['s1'], pinAmps: true }), 'scope');
    expect(watches().at(-1)).toEqual(watch({ volts: ['n1'], waves: ['s1'], pinAmps: true }));

    await bridge.watchAnalog(watch({ volts: ['n2'] }), 'flow');
    expect(watches().at(-1)).toEqual(watch({ volts: ['n2'], waves: ['s1'], pinAmps: true }));

    await bridge.unwatchAnalog('scope');
    expect(watches().at(-1)).toEqual(watch({ volts: ['n2'] }));
    await bridge.unwatchAnalog('flow');
    expect(watches().at(-1)).toEqual(watch({}));
    await bridge.dispose();
  });

  it('treats a call with no owner as the owner default', async () => {
    const { port, watches } = recorded();
    const bridge = createSimBridge({ port });
    await bridge.load(doc);
    await bridge.watchAnalog(watch({ volts: ['a'] }));
    await bridge.watchAnalog(watch({ volts: ['b'] }));
    expect(watches().at(-1)).toEqual(watch({ volts: ['b'] }));
    await bridge.unwatchAnalog('default');
    expect(watches().at(-1)).toEqual(watch({}));
    await bridge.dispose();
  });

  it('sends the union again after every load, and nothing when no owner exists', async () => {
    const { port, watches } = recorded();
    const bridge = createSimBridge({ port });
    await bridge.load(doc);
    expect(watches()).toEqual([]);
    await bridge.watchAnalog(watch({ volts: ['n1'] }), 'flow');
    await bridge.watchAnalog(watch({ waves: ['s1'] }), 'scope');
    const before = watches().length;
    await bridge.load(doc);
    expect(watches().length).toBe(before + 1);
    expect(watches().at(-1)).toEqual(watch({ volts: ['n1'], waves: ['s1'] }));
    await bridge.dispose();
  });
});
