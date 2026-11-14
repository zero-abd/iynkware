/** The pillar's analog feed: owners' watches merged, sent again after a load, frame deltas laid over the last state. */
import { describe, expect, it } from 'vitest';
import type { AnalogWatch, RunState, SimBridge, SimFrame } from '../../src/contracts/sim';
import { analogFeed, mergeWatches } from '../../src/scale/kit/analog';

const W = (w: Partial<AnalogWatch>): AnalogWatch => ({ volts: [], amps: [], pinAmps: false, waves: [], ...w });

function fakeSim() {
  const states = new Set<(s: RunState) => void>();
  const frames = new Set<(f: SimFrame) => void>();
  const sent: AnalogWatch[] = [];
  const sim = {
    state: 'unloaded' as RunState,
    onState: (fn: (s: RunState) => void) => (states.add(fn), () => states.delete(fn)),
    onFrame: (fn: (f: SimFrame) => void) => (frames.add(fn), () => frames.delete(fn)),
    watchAnalog: async (w: AnalogWatch) => void sent.push(w),
  };
  const setState = (s: RunState) => {
    sim.state = s;
    states.forEach((fn) => fn(s));
  };
  const frame = (analog?: SimFrame['analog']) =>
    frames.forEach((fn) => fn({ atNs: 0, pins: {}, parts: new Map(), serial: [], ...(analog ? { analog } : {}) }));
  return { sim: sim as unknown as SimBridge, sent, setState, frame };
}

describe('mergeWatches', () => {
  it('takes the union, with all winning', () => {
    expect(mergeWatches([W({ volts: ['n2'] }), W({ volts: ['n1', 'n2'], pinAmps: true, waves: ['p1'] })])).toEqual(
      W({ volts: ['n1', 'n2'], pinAmps: true, waves: ['p1'] }),
    );
    expect(mergeWatches([W({ volts: 'all' }), W({ volts: ['n1'], amps: ['R1'] })])).toEqual(W({ volts: 'all', amps: ['R1'] }));
    expect(mergeWatches([])).toEqual(W({}));
  });
});

describe('analogFeed', () => {
  it('is one feed per bridge and sends the merged watch only while a run is loaded', () => {
    const { sim, sent, setState } = fakeSim();
    const feed = analogFeed({ sim });
    expect(analogFeed({ sim })).toBe(feed);
    const offFlow = feed.want('flow', W({ volts: 'all', pinAmps: true }));
    expect(sent).toEqual([]);
    setState('idle');
    expect(sent.at(-1)).toEqual(W({ volts: 'all', pinAmps: true }));
    feed.want('probe', W({ amps: ['R1'] }));
    expect(sent.at(-1)).toEqual(W({ volts: 'all', amps: ['R1'], pinAmps: true }));
    offFlow();
    expect(sent.at(-1)).toEqual(W({ amps: ['R1'] }));
  });

  it('lays deltas over the last state and clears when the run ends', () => {
    const { sim, setState, frame } = fakeSim();
    const feed = analogFeed({ sim }, () => 0);
    const seen: Array<number | null> = [];
    feed.onChange((v) => seen.push(v ? (v.volts.n1 ?? -1) : null));
    feed.want('flow', W({ volts: 'all' }));
    setState('running');
    frame({ full: true, volts: { n1: 5, n2: 0 } });
    frame({ full: false, volts: { n2: 1 } });
    expect(feed.view?.volts).toEqual({ n1: 5, n2: 1 });
    setState('idle');
    expect(seen).toEqual([5, 5]);
    setState('unloaded');
    expect(feed.view).toBeNull();
    expect(seen.at(-1)).toBeNull();
  });

  it('sends the watch again when frames come without analog values', () => {
    const { sim, sent, setState, frame } = fakeSim();
    let clock = 0;
    const feed = analogFeed({ sim }, () => clock);
    feed.want('flow', W({ volts: 'all' }));
    setState('running');
    const n = sent.length;
    frame();
    expect(sent.length).toBe(n);
    clock = 600;
    frame();
    expect(sent.length).toBe(n + 1);
  });
});
