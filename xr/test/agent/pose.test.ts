import { describe, expect, it } from 'vitest';
import { createCoach } from '../../src/agent/coach/coach';
import { refOfInput } from '../../src/agent/coach/index';
import { createPoseWatcher, describePose, gazeTarget, nearTarget, type PoseSample, type PoseTarget } from '../../src/agent/coach/pose';

const TARGETS: PoseTarget[] = [
  { ref: 'part:r1', name: 'RES1', at: [0, 1, -0.5] },
  { ref: 'part:led1', name: 'LED1', at: [0.1, 1, -0.5] },
  { ref: 'part:uno', name: 'UNO1', at: [-0.3, 1, -0.5] },
];
const look = (x: number, y = 1, z = -0.5) => {
  const d = [x, y - 1.2, z - 0];
  const n = Math.hypot(d[0]!, d[1]!, d[2]!);
  return { origin: [0, 1.2, 0] as const, dir: [d[0]! / n, d[1]! / n, d[2]! / n] as const };
};
const sample = (o: Partial<PoseSample> = {}): PoseSample => ({
  head: look(0),
  hands: { left: null, right: null },
  held: { left: null, right: null },
  targets: TARGETS,
  ...o,
});

function clocked() {
  let t = 0;
  return { now: () => t, step: (ms: number) => (t += ms) };
}

describe('gaze and reach', () => {
  it('picks the target on the head ray, none when looking away', () => {
    expect(gazeTarget(look(0), TARGETS)?.name).toBe('RES1');
    expect(gazeTarget(look(0.1), TARGETS)?.name).toBe('LED1');
    expect(gazeTarget({ origin: [0, 1.2, 0], dir: [0, 0, 1] }, TARGETS)).toBeNull();
    expect(gazeTarget(null, TARGETS)).toBeNull();
  });

  it('keeps the current gaze target through a small drift toward a neighbour', () => {
    // Just past half way from RES1 to LED1: alone it is LED1, but RES1 is kept.
    expect(gazeTarget(look(0.055), TARGETS)?.name).toBe('LED1');
    expect(gazeTarget(look(0.055), TARGETS, 'part:r1')?.name).toBe('RES1');
  });

  it('finds what is within reach of a hand', () => {
    expect(nearTarget([0.1, 1.05, -0.5], TARGETS)?.name).toBe('LED1');
    expect(nearTarget([0.5, 1, -0.5], TARGETS)).toBeNull();
  });

  it('describes a view in one compact line', () => {
    expect(describePose({ look: TARGETS[0]!, left: null, right: { ref: 'part:led1', name: 'LED1', holding: true } })).toBe('looking at RES1; right hand holding LED1');
    expect(describePose({ look: null, left: null, right: null })).toBe('');
  });
});

describe('pose watcher', () => {
  it('reports a view once it settles, once, and not again while it holds', () => {
    const c = clocked();
    const w = createPoseWatcher(c.now);
    expect(w.sample(sample())).toBeNull();
    c.step(500);
    expect(w.sample(sample())).toBeNull();
    c.step(400);
    const o = w.sample(sample({ hands: { left: null, right: [0.1, 1.02, -0.5] } }));
    // The hand just arrived: the new view must settle first.
    expect(o).toBeNull();
    c.step(900);
    const o2 = w.sample(sample({ hands: { left: null, right: [0.1, 1.02, -0.5] } }));
    expect(o2).toEqual({ kind: 'pose', text: 'looking at RES1; right hand near LED1', refs: ['part:r1', 'part:led1'] });
    for (let i = 0; i < 20; i++) {
      c.step(100);
      expect(w.sample(sample({ hands: { left: null, right: [0.1, 1.02, -0.5] } }))).toBeNull();
    }
  });

  it('sends at most one pose line per gap, the newest view winning', () => {
    const c = clocked();
    const w = createPoseWatcher(c.now, { settleMs: 0, gapMs: 5000 });
    const out: string[] = [];
    const run = (x: number, ms: number) => {
      for (let t = 0; t < ms; t += 100) {
        const o = w.sample(sample({ head: look(x) }));
        if (o) out.push(o.text);
        c.step(100);
      }
    };
    run(0, 1000);
    run(0.1, 1000);
    run(-0.3, 4000);
    expect(out).toEqual(['looking at RES1', 'looking at UNO1']);
  });

  it('says nothing for an empty view, and says what a hand holds even off the target list', () => {
    const c = clocked();
    const w = createPoseWatcher(c.now, { settleMs: 0 });
    expect(w.sample(sample({ head: { origin: [0, 1.2, 0], dir: [0, 0, 1] } }))).toBeNull();
    c.step(6000);
    const o = w.sample(sample({ head: { origin: [0, 1.2, 0], dir: [0, 0, 1] }, held: { left: 'lab:beaker-1', right: null } }));
    expect(o?.text).toBe('left hand holding beaker-1');
  });

  it('flags a dwell once when the person stays on one thing with no action, and again only after activity', () => {
    const c = clocked();
    const w = createPoseWatcher(c.now, { dwellMs: 20_000 });
    const kinds: string[] = [];
    const run = (ms: number) => {
      for (let t = 0; t < ms; t += 100) {
        const o = w.sample(sample());
        if (o) kinds.push(`${o.kind}:${o.text}`);
        c.step(100);
      }
    };
    run(45_000);
    expect(kinds).toEqual(['pose:looking at RES1', 'dwell:dwell 20 s with no action: looking at RES1 (may be stuck)']);
    w.activity();
    run(10_000);
    expect(kinds).toHaveLength(2);
    run(11_000);
    expect(kinds.at(-1)).toBe('dwell:dwell 20 s with no action: looking at RES1 (may be stuck)');
  });

  it('goes through the coach as single short lines, never a stream', () => {
    const c = clocked();
    const coach = createCoach(c.now);
    const w = createPoseWatcher(c.now);
    for (let t = 0; t < 60_000; t += 100) {
      // Head wanders across the three parts every 1.5 s.
      const x = [0, 0.1, -0.3][Math.floor(t / 1500) % 3]!;
      const o = w.sample(sample({ head: look(x) }));
      if (o) coach.push(o);
      coach.tick();
      c.step(100);
    }
    const sent = coach.recent();
    expect(sent.length).toBeLessThanOrEqual(12);
    for (const o of sent) expect(o.text.length).toBeLessThan(120);
    for (let i = 1; i < sent.length; i++) expect(sent[i]!.at - sent[i - 1]!.at).toBeGreaterThanOrEqual(5000);
  });

  it('maps input target ids to coach refs', () => {
    expect(refOfInput('lab-grab:burner-1')).toBe('lab:burner-1');
    expect(refOfInput('cmp_led1')).toBe('part:cmp_led1');
  });
});
