import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_XR_SETTINGS, type XrSettings } from '../src/contracts/settings';
import type { FeedbackEvent } from '../src/contracts/feedback';
import { createFeedbackService, FEEDBACK, specOf, type Synth } from '../src/ui/feedback';

const val = <T>(value: T) => ({ value, subscribe: () => () => undefined });

function rig(xr: Partial<XrSettings> = {}, source: 'hand' | 'controller' = 'controller', blurred = false) {
  const pulses: Array<[string, number, number]> = [];
  const sounds: Array<[string, number, boolean]> = [];
  const rings: number[][] = [];
  let t = 0;
  const synth: Synth = { play: (n, level, _at, mono) => void sounds.push([n, level, mono]), dispose: () => undefined };
  const fb = createFeedbackService({
    world: { camera: {} as never, visibilityState: val((blurred ? 'visible-blurred' : 'visible') as never) },
    input: { pulse: (h, i, ms) => void pulses.push([h, i, ms]), sources: val({ left: source, right: source }) as never },
    settings: { xr: val({ ...DEFAULT_XR_SETTINGS, ...xr }) as never },
    ring: (at) => void rings.push([...at]),
    synth,
    now: () => t,
  });
  return { fb, pulses, sounds, rings, advance: (ms: number) => (t += ms) };
}

describe('feedback service', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('has a table entry for every event, and maps the run cue names', () => {
    const events: FeedbackEvent[] = ['hover-grabbable', 'hover-ui', 'hover-cell', 'snap', 'seat', 'pull', 'wire', 'undo', 'invalid', 'ui-press', 'short', 'hot', 'burnt', 'check-pass', 'check-fail', 'run-start', 'run-stop'];
    expect(Object.keys(FEEDBACK).sort()).toEqual([...events].sort());
    expect(specOf('clip')).toBe(FEEDBACK.seat);
    expect(specOf('nope')).toBeUndefined();
  });

  it('plays a two-part haptic with its offset on the hand that caused it, and none without a hand', () => {
    const r = rig();
    r.fb.play('seat', [0, 1, 0], 'right');
    expect(r.pulses).toEqual([['right', 0.6, 30]]);
    vi.advanceTimersByTime(50);
    expect(r.pulses).toEqual([['right', 0.6, 30], ['right', 0.3, 15]]);
    r.fb.play('seat', [0, 1, 0], null);
    vi.advanceTimersByTime(100);
    expect(r.pulses).toHaveLength(2);
  });

  it('applies the bus volume, and is silent with sound off or behind the system overlay', () => {
    const r = rig({ volumes: { interface: 0.5, bench: 0.8, simulation: 0.7, alerts: 1 } });
    r.fb.play('ui-press', null, 'left');
    expect(r.sounds).toEqual([['tap', 0.22 * 0.5, false]]);
    const off = rig({ sound: false });
    off.fb.play('ui-press', null, 'left');
    expect(off.sounds).toEqual([]);
    const blurred = rig({}, 'controller', true);
    blurred.fb.play('seat', [0, 0, 0], 'left');
    expect(blurred.sounds).toEqual([]);
    expect(blurred.rings).toEqual([]);
  });

  it('caps snap ticks at 12 a second', () => {
    const r = rig();
    r.fb.play('snap');
    r.advance(40);
    r.fb.play('snap');
    r.advance(50);
    r.fb.play('snap');
    expect(r.sounds.map((s) => s[0])).toEqual(['tick', 'tick']);
  });

  it('shows a pop ring for a hand, or for anyone with sound off, never for hover', () => {
    const hand = rig({}, 'hand');
    hand.fb.play('wire', [1, 2, 3], 'right');
    hand.fb.play('hover-grabbable', [1, 2, 3], 'right');
    expect(hand.rings).toEqual([[1, 2, 3]]);
    const ctl = rig();
    ctl.fb.play('wire', [1, 2, 3], 'right');
    expect(ctl.rings).toEqual([]);
    const quiet = rig({ sound: false });
    quiet.fb.play('wire', [1, 2, 3], null);
    expect(quiet.rings).toEqual([[1, 2, 3]]);
  });

  it('never throws, and plays nothing after dispose', () => {
    const r = rig();
    expect(() => r.fb.play('unknown' as FeedbackEvent)).not.toThrow();
    r.fb.play('seat', null, 'left');
    r.fb.dispose();
    vi.advanceTimersByTime(100);
    r.fb.play('seat', null, 'left');
    expect(r.pulses).toEqual([['left', 0.6, 30]]);
  });
});
