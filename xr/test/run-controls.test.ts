import { describe, expect, test } from 'vitest';
import type { Touched } from '@/project/touched';
import type { Op } from '@/project/generated/types';
import type { RunState } from '../src/contracts/sim';
import { stringProblems } from '../src/run/kit/strings';
import { controlStrings } from '../src/run/controls/strings';
import {
  COMPILE_MS,
  HEARTBEAT_S,
  STEP_MS,
  UPLOAD_MS,
  badgeOf,
  clockSeconds,
  clockText,
  dueAt,
  editKind,
  haltReason,
  initialState,
  loadReason,
  next,
  progressOf,
  viewOf,
  type ClusterEvent,
  type ClusterState,
  type Effect,
} from '../src/run/controls/machine';

/** Feeds events in order at the given times; collects every effect. */
function drive(s: ClusterState, events: ReadonlyArray<[number, ClusterEvent]>): { s: ClusterState; effects: Effect[] } {
  const effects: Effect[] = [];
  for (const [now, e] of events) {
    const r = next(s, e, now);
    s = r.state;
    effects.push(...r.effects);
  }
  return { s, effects };
}

const press = (control: 'run' | 'step' | 'reset' | 'speed'): ClusterEvent => ({ t: 'press', control });
const bridge = (state: RunState): ClusterEvent => ({ t: 'bridge', state });
const tick: ClusterEvent = { t: 'tick' };

/** Run pressed at 0, the load answering at 100 ms, then the 600 ms phases. Ends running at 1200 ms. */
function running(): ClusterState {
  const { s } = drive(initialState('unloaded'), [
    [0, press('run')],
    [100, bridge('idle')],
    [100, { t: 'loaded', id: 1, ok: true }],
    [COMPILE_MS, tick],
    [COMPILE_MS + UPLOAD_MS, tick],
    [1210, bridge('running')],
  ]);
  return s;
}

const touched = (patch: Partial<Record<keyof Touched, string[]>> = {}): Touched => ({
  components: new Set(patch.components ?? []),
  nets: new Set(patch.nets ?? []),
  wires: new Set(patch.wires ?? []),
  views: new Set(patch.views ?? []),
  sources: new Set(patch.sources ?? []),
});

describe('run cluster: starting a run', () => {
  test('stopped for every idle bridge state, faulted for the bad ones', () => {
    for (const b of ['unloaded', 'idle', 'done'] as const) expect(initialState(b).phase).toBe('stopped');
    expect(initialState('halted').phase).toBe('faulted');
    expect(initialState('error').reason).toBe('refused');
    expect(initialState('running').phase).toBe('running');
  });

  test('Run compiles for at least 600 ms, uploads for 600 ms, then runs with the start cue', () => {
    let r = next(initialState('unloaded'), press('run'), 0);
    expect(r.state.phase).toBe('compiling');
    expect(r.effects).toEqual([{ t: 'load', id: 1 }]);
    expect(viewOf(r.state).run).toMatchObject({ label: 'compiling', icon: 'run' });
    expect(viewOf(r.state).stepDisabled).toBe(true);
    // The bridge says idle when the load lands; the cluster stays compiling.
    r = next(r.state, bridge('idle'), 100);
    expect(r.state.phase).toBe('compiling');
    r = next(r.state, { t: 'loaded', id: 1, ok: true }, 100);
    expect(r.state.phase).toBe('compiling');
    expect(dueAt(r.state)).toBe(COMPILE_MS);
    expect(progressOf(r.state, 300)).toBeCloseTo(0.5);
    r = next(r.state, tick, COMPILE_MS - 1);
    expect(r.state.phase).toBe('compiling');
    r = next(r.state, tick, COMPILE_MS);
    expect(r.state.phase).toBe('uploading');
    expect(viewOf(r.state).run.label).toBe('uploading');
    expect(dueAt(r.state)).toBe(COMPILE_MS + UPLOAD_MS);
    r = next(r.state, tick, COMPILE_MS + UPLOAD_MS - 1);
    expect(r.state.phase).toBe('uploading');
    r = next(r.state, tick, COMPILE_MS + UPLOAD_MS);
    expect(r.state.phase).toBe('running');
    expect(r.effects).toEqual([{ t: 'cue', cue: 'run-start' }, { t: 'run' }]);
    expect(viewOf(r.state).run).toMatchObject({ icon: 'pause', label: 'pause' });
    expect(viewOf(r.state).ring).toBe('crawl');
    // The bridge confirming is an echo: no second cue.
    expect(next(r.state, bridge('running'), 1210).effects).toEqual([]);
  });

  test('a slow load holds compiling at 0.9 and uploads as soon as it answers', () => {
    let r = next(initialState('idle'), press('run'), 0);
    expect(dueAt(r.state)).toBeNull();
    expect(progressOf(r.state, 2000)).toBe(0.9);
    r = next(r.state, tick, 2000);
    expect(r.state.phase).toBe('compiling');
    r = next(r.state, { t: 'loaded', id: 1, ok: true }, 2500);
    expect(r.state.phase).toBe('uploading');
    expect(r.state.since).toBe(2500);
  });

  test('a press during compiling or uploading does nothing', () => {
    const compiling = next(initialState('unloaded'), press('run'), 0).state;
    for (const c of ['run', 'step'] as const) {
      const r = next(compiling, press(c), 50);
      expect(r.state).toBe(compiling);
      expect(r.effects).toEqual([]);
    }
    const uploading = drive(compiling, [
      [100, { t: 'loaded', id: 1, ok: true }],
      [COMPILE_MS, tick],
    ]).s;
    expect(uploading.phase).toBe('uploading');
    expect(next(uploading, press('run'), 700).effects).toEqual([]);
  });

  test('a refused load faults with its reason, and Run from faulted loads again', () => {
    let r = next(initialState('unloaded'), press('run'), 0);
    r = next(r.state, bridge('error'), 20);
    expect(r.state.phase).toBe('compiling');
    r = next(r.state, { t: 'loaded', id: 1, ok: false, reason: 'no-code' }, 20);
    expect(r.state.phase).toBe('faulted');
    expect(r.effects).toEqual([]);
    expect(viewOf(r.state).run).toMatchObject({ label: 'run', badge: 'no-code', tone: 'bad' });
    expect(viewOf(r.state).ring).toBe('none');
    r = next(r.state, press('run'), 1000);
    expect(r.state.phase).toBe('compiling');
    expect(r.state.reason).toBeNull();
    expect(r.effects).toEqual([{ t: 'load', id: 2 }]);
  });

  test('a late answer of an earlier load is ignored', () => {
    let r = next(initialState('unloaded'), press('run'), 0);
    r = next(r.state, press('reset'), 10);
    r = next(r.state, press('run'), 20);
    expect(r.effects).toEqual([{ t: 'load', id: 2 }]);
    const late = next(r.state, { t: 'loaded', id: 1, ok: false }, 30);
    expect(late.state).toBe(r.state);
  });
});

describe('run cluster: pause, step, reset', () => {
  test('Pause pauses with the stop cue; Run from paused resumes without loading again', () => {
    let r = next(running(), press('run'), 2000);
    expect(r.state.phase).toBe('paused');
    expect(r.effects).toEqual([{ t: 'cue', cue: 'run-stop' }, { t: 'pause' }]);
    expect(viewOf(r.state).ring).toBe('still');
    expect(viewOf(r.state).run).toMatchObject({ icon: 'run', label: 'run', badge: null });
    expect(next(r.state, bridge('paused'), 2010).effects).toEqual([]);
    r = next(r.state, press('run'), 3000);
    expect(r.state.phase).toBe('running');
    expect(r.effects).toEqual([{ t: 'cue', cue: 'run-start' }, { t: 'run' }]);
    expect(r.effects.some((e) => e.t === 'load')).toBe(false);
  });

  test('Step from paused steps 10 ms; from running it pauses first', () => {
    const paused = next(running(), press('run'), 2000).state;
    expect(next(paused, press('step'), 2100)).toEqual({ state: paused, effects: [{ t: 'step', ms: STEP_MS }] });
    const r = next(running(), press('step'), 2000);
    expect(r.state.phase).toBe('paused');
    expect(r.effects).toEqual([{ t: 'cue', cue: 'run-stop' }, { t: 'pause' }, { t: 'step', ms: 10 }]);
  });

  test('Step from stopped loads, uploads, then steps and stays paused', () => {
    const { s, effects } = drive(initialState('unloaded'), [
      [0, press('step')],
      [50, { t: 'loaded', id: 1, ok: true }],
      [COMPILE_MS, tick],
      [COMPILE_MS + UPLOAD_MS, tick],
      [1250, bridge('paused')],
    ]);
    expect(effects).toEqual([{ t: 'load', id: 1 }, { t: 'step', ms: 10 }]);
    expect(s.phase).toBe('paused');
  });

  test('Reset stops from any phase, with the stop cue only when running', () => {
    let r = next(running(), press('reset'), 2000);
    expect(r.state.phase).toBe('stopped');
    expect(r.effects).toEqual([{ t: 'cue', cue: 'run-stop' }, { t: 'stop' }]);
    // The bridge's pause-then-idle on the way to the stop moves nothing.
    expect(next(r.state, bridge('paused'), 2010).state).toBe(r.state);
    expect(next(r.state, bridge('idle'), 2020).state).toBe(r.state);
    const paused = next(running(), press('run'), 2000).state;
    expect(next(paused, press('reset'), 2100).effects).toEqual([{ t: 'stop' }]);
    const compiling = next(initialState('unloaded'), press('run'), 0).state;
    r = next(compiling, press('reset'), 100);
    expect(r.state.phase).toBe('stopped');
    expect(next(r.state, { t: 'loaded', id: 1, ok: true }, 200).state.phase).toBe('stopped');
  });

  test('a finished run is stopped, and Run loads and starts it again', () => {
    let r = next(running(), bridge('done'), 5000);
    expect(r.state.phase).toBe('stopped');
    expect(r.effects).toEqual([{ t: 'cue', cue: 'run-stop' }]);
    r = next(r.state, press('run'), 6000);
    expect(r.state.phase).toBe('compiling');
    expect(r.effects).toEqual([{ t: 'load', id: 2 }]);
    const { s, effects } = drive(r.state, [
      [6050, { t: 'loaded', id: 2, ok: true }],
      [6000 + COMPILE_MS, tick],
      [6000 + COMPILE_MS + UPLOAD_MS, tick],
    ]);
    expect(s.phase).toBe('running');
    expect(effects).toEqual([{ t: 'cue', cue: 'run-start' }, { t: 'run' }]);
  });

  test('Speed cycles 1/10, 1/4, 1/2, 1, 2 and survives a reset and a new load', () => {
    let s = initialState('unloaded');
    expect(viewOf(s).speedLabel).toBe('x1');
    const seen: string[] = [];
    const xs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = next(s, press('speed'), i);
      s = r.state;
      seen.push(viewOf(s).speedLabel);
      xs.push((r.effects[0] as { x: number }).x);
    }
    expect(seen).toEqual(['x2', 'x1/10', 'x1/4', 'x1/2', 'x1']);
    expect(xs).toEqual([2, 0.1, 0.25, 0.5, 1]);
    s = next(next(s, press('speed'), 10).state, press('speed'), 11).state;
    expect(viewOf(s).speedLabel).toBe('x1/10');
    s = next(s, press('reset'), 20).state;
    s = next(s, press('run'), 30).state;
    expect(viewOf(s).speedLabel).toBe('x1/10');
  });
});

describe('run cluster: away, faults and the bridge', () => {
  test('the system overlay pauses a running run with the reason away; it stays paused until Run', () => {
    let r = next(running(), { t: 'visibility', state: 'visible-blurred' }, 2000);
    expect(r.state.phase).toBe('paused');
    expect(r.effects).toEqual([{ t: 'cue', cue: 'run-stop' }, { t: 'pause' }]);
    expect(viewOf(r.state).run).toMatchObject({ badge: 'away', tone: 'info' });
    // main.ts pauses as well: its echo changes nothing.
    r = next(r.state, bridge('paused'), 2010);
    expect(r.state.reason).toBe('away');
    r = next(r.state, { t: 'visibility', state: 'visible' }, 3000);
    expect(r.state.phase).toBe('paused');
    expect(r.effects).toEqual([]);
    expect(badgeOf(r.state).badge).toBe('away');
    r = next(r.state, press('run'), 4000);
    expect(r.state.phase).toBe('running');
    expect(badgeOf(r.state).badge).toBeNull();
  });

  test('a pause that arrives from the bridge while the overlay is up is an away pause', () => {
    let s = next(running(), { t: 'visibility', state: 'visible' }, 1300).state;
    // Suppose main.ts's pause landed first and the visibility reached us after (order is not promised).
    s = { ...s, visibility: 'visible-blurred' };
    const r = next(s, bridge('paused'), 2000);
    expect(r.state.phase).toBe('paused');
    expect(r.state.reason).toBe('away');
    expect(r.effects).toEqual([{ t: 'cue', cue: 'run-stop' }]);
    // A pause from elsewhere with the overlay down has no reason.
    expect(next(running(), bridge('paused'), 2000).state.reason).toBeNull();
  });

  test('a run that finishes uploading while away waits, paused', () => {
    const { s, effects } = drive(initialState('unloaded'), [
      [0, press('run')],
      [50, { t: 'loaded', id: 1, ok: true }],
      [COMPILE_MS, tick],
      [700, { t: 'visibility', state: 'visible-blurred' }],
      [COMPILE_MS + UPLOAD_MS, tick],
    ]);
    expect(s.phase).toBe('paused');
    expect(s.reason).toBe('away');
    expect(effects).toEqual([{ t: 'load', id: 1 }]);
  });

  test('halted, limit and error fault the run, naming the reason from the last diagnostic', () => {
    let r = next(next(running(), { t: 'diagnostic', kind: 'output-contention' }, 1500).state, bridge('halted'), 1600);
    expect(r.state.phase).toBe('faulted');
    expect(r.effects).toEqual([{ t: 'cue', cue: 'run-stop' }]);
    expect(viewOf(r.state).run).toMatchObject({ badge: 'contention', tone: 'bad', icon: 'run' });
    r = next(running(), bridge('limit'), 1600);
    expect(viewOf(r.state).run).toMatchObject({ badge: 'limit', tone: 'warn' });
    expect(haltReason('halted', null)).toBe('halted');
    expect(haltReason('limit', 'no-time-progress')).toBe('stuck');
    expect(haltReason('error', 'output-contention')).toBe('refused');
    expect(loadReason([{ id: 'unknown-ground' }])).toBe('refused');
    expect(loadReason([{ id: 'unknown-ground' }, { id: 'no-firmware' }])).toBe('no-code');
    // A new load forgets the diagnostic.
    const again = next(r.state, press('run'), 2000).state;
    expect(again.diagnostic).toBeNull();
  });

  test('bridge states we did not ask for move the phase', () => {
    let r = next(initialState('idle'), bridge('running'), 10);
    expect(r.state.phase).toBe('running');
    expect(r.effects).toEqual([{ t: 'cue', cue: 'run-start' }]);
    r = next(r.state, bridge('idle'), 20);
    expect(r.state.phase).toBe('stopped');
    expect(r.effects).toEqual([{ t: 'cue', cue: 'run-stop' }]);
    expect(next(r.state, bridge('unloaded'), 30).state).toBe(r.state);
  });
});

describe('run cluster: edits while running', () => {
  const code = { t: 'edit', kind: 'code', origin: 'local' } as const;
  const circuit = { t: 'edit', kind: 'circuit', origin: 'local' } as const;

  test('a code edit puts Restart to apply on Run until the next Reset or load', () => {
    let r = next(running(), code, 2000);
    expect(r.effects).toEqual([]);
    expect(r.state.phase).toBe('running');
    expect(viewOf(r.state).run).toMatchObject({ icon: 'pause', badge: 'restart', tone: 'warn' });
    r = next(r.state, press('run'), 2100);
    expect(badgeOf(r.state).badge).toBe('restart');
    expect(badgeOf(next(r.state, press('reset'), 2200).state).badge).toBeNull();
    // A load clears it too: Run from stopped after the run finished.
    const done = next(next(running(), code, 2000).state, bridge('done'), 3000).state;
    expect(badgeOf(done).badge).toBe('restart');
    expect(badgeOf(next(done, press('run'), 3100).state).badge).toBeNull();
  });

  test('a code edit while stopped needs no badge, and a load change is never a code edit', () => {
    expect(next(initialState('idle'), code, 0).state.restart).toBe(false);
    const r = next(running(), { t: 'edit', kind: 'code', origin: 'load' }, 2000);
    expect(r.state.restart).toBe(false);
  });

  test('a circuit edit reloads in place and resumes running', () => {
    let r = next(running(), circuit, 2000);
    expect(r.state.phase).toBe('running');
    expect(r.effects).toEqual([{ t: 'load', id: 2 }]);
    // The load's idle is not a stop.
    r = next(r.state, bridge('idle'), 2050);
    expect(r.state.phase).toBe('running');
    expect(r.effects).toEqual([]);
    r = next(r.state, { t: 'loaded', id: 2, ok: true }, 2060);
    expect(r.state.phase).toBe('running');
    expect(r.state.reloading).toBe(false);
    expect(r.effects).toEqual([{ t: 'run' }]);
    // A reload also applies pending code.
    const both = drive(running(), [
      [2000, code],
      [2001, circuit],
      [2050, { t: 'loaded', id: 2, ok: true }],
    ]).s;
    expect(both.restart).toBe(false);
  });

  test('a circuit edit while paused reloads and stays paused; a refused reload faults', () => {
    const paused = next(running(), press('run'), 2000).state;
    let r = next(paused, circuit, 2100);
    r = next(r.state, { t: 'loaded', id: 2, ok: true }, 2150);
    expect(r.state.phase).toBe('paused');
    expect(r.effects).toEqual([]);
    r = next(next(running(), circuit, 2000).state, { t: 'loaded', id: 2, ok: false, reason: 'refused' }, 2050);
    expect(r.state.phase).toBe('faulted');
    expect(r.effects).toEqual([{ t: 'cue', cue: 'run-stop' }]);
  });

  test('a circuit edit while compiling compiles again; while stopped it does nothing', () => {
    let r = next(initialState('unloaded'), press('run'), 0);
    r = next(r.state, { t: 'loaded', id: 1, ok: true }, 100);
    r = next(r.state, circuit, 200);
    expect(r.effects).toEqual([{ t: 'load', id: 2 }]);
    expect(r.state.loaded).toBe(false);
    expect(next(r.state, tick, COMPILE_MS).state.phase).toBe('compiling');
    expect(next(initialState('idle'), circuit, 0).effects).toEqual([]);
  });

  test('opening another document stops the run', () => {
    const r = next(running(), { t: 'edit', kind: 'circuit', origin: 'load' }, 2000);
    expect(r.state.phase).toBe('stopped');
    expect(r.effects).toEqual([{ t: 'cue', cue: 'run-stop' }, { t: 'stop' }]);
  });

  test('editKind: circuit for parts, wires, nets and parameters; code for sources; none for placements', () => {
    expect(editKind({ touched: touched({ components: ['cmp_led1'] }), ops: [] })).toBe('circuit');
    expect(editKind({ touched: touched({ wires: ['wir_1'] }), ops: [] })).toBe('circuit');
    expect(editKind({ touched: touched(), ops: [{ k: 'param.set' } as unknown as Op] })).toBe('circuit');
    expect(editKind({ touched: touched({ sources: ['src_main'] }), ops: [{ k: 'source.edit' } as unknown as Op] })).toBe('code');
    expect(editKind({ touched: touched({ views: ['view_bb'] }), ops: [{ k: 'view.place' } as unknown as Op] })).toBe('none');
  });
});

describe('run cluster: the clock', () => {
  test('shows simulated time and the speed', () => {
    expect(clockText(12.345, 1)).toBe('t 12.34 s  x1/4');
    expect(clockText(0, 3)).toBe('t 0.00 s  x1');
    expect(clockText(1.5, 0)).toBe('t 1.50 s  x1/10');
    expect(clockText(0.29, 4)).toBe('t 0.29 s  x2');
  });

  test('runs on from the last frame at the speed, by at most one heartbeat', () => {
    expect(clockSeconds(2e9, 100, 1, true)).toBeCloseTo(2.1);
    expect(clockSeconds(2e9, 100, 0.1, true)).toBeCloseTo(2.01);
    expect(clockSeconds(2e9, 5000, 1, true)).toBeCloseTo(2 + HEARTBEAT_S);
    expect(clockSeconds(2e9, 5000, 1, false)).toBe(2);
  });
});

describe('run cluster strings', () => {
  test('six languages, no problems', () => {
    expect(stringProblems(controlStrings.table)).toEqual([]);
    expect(controlStrings.t('de', 'run')).toBe('Starten');
    expect(controlStrings.t('en', 'restart')).toBe('Restart to apply');
  });
});
