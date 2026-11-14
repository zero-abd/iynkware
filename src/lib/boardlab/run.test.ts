import { describe, expect, it, vi } from 'vitest';
import type { WorldModel } from '@/content/schema';
import type { FigureHandle } from '@/components/figure/protocol';
import { LessonRunner, type Scheduler } from './run';
import { createBoardLabStore, initialState } from './store';

const BLINK = `void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(9600);
  Serial.println("Blink ready");
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  Serial.println("on");
  delay(1000);
  digitalWrite(LED_BUILTIN, LOW);
  Serial.println("off");
  delay(1000);
}
`;

/** Sets D13 once and never touches it again, like a lesson whose outputs never change. */
const STEADY = `void setup() {
  pinMode(13, OUTPUT);
  digitalWrite(13, HIGH);
}

void loop() {
  delay(1000);
}
`;

const NO_WORLD: WorldModel = { inputs: [], script: [] };

/** A hand-driven clock: frames and timeouts run only when the test advances time. */
class FakeScheduler implements Scheduler {
  t = 0;
  private seq = 1;
  private frames = new Map<number, (now: number) => void>();
  private timers = new Map<number, { at: number; cb: () => void }>();
  now = () => this.t;
  frame = (cb: (now: number) => void) => {
    const id = this.seq++;
    this.frames.set(id, cb);
    return id;
  };
  cancelFrame = (id: number) => void this.frames.delete(id);
  timeout = (cb: () => void, ms: number) => {
    const id = this.seq++;
    this.timers.set(id, { at: this.t + ms, cb });
    return id;
  };
  clearTimeout = (id: number) => void this.timers.delete(id);
  /** Move real time forward in 16 ms frames, firing due timers and frames. */
  advance(ms: number) {
    const end = this.t + ms;
    while (this.t < end) {
      this.t = Math.min(end, this.t + 16);
      for (const [id, timer] of [...this.timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= this.t) {
          this.timers.delete(id);
          timer.cb();
        }
      }
      const frames = [...this.frames];
      this.frames.clear();
      for (const [, cb] of frames) cb(this.t);
    }
  }
}

/** Lets the runner's lazy load of the engine finish; the fake clock does not move meanwhile. */
const engineLoaded = async () => {
  await import('./engine');
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function fakeFigure() {
  const sent: Record<string, unknown>[] = [];
  const handle = {
    send: (type: string, payload?: { state?: Record<string, unknown> }) => {
      if (type === 'set' && payload?.state) sent.push(payload.state);
    },
    observe: () => () => {},
    isReady: () => true,
    info: () => null,
    focus: () => {},
  } as unknown as FigureHandle;
  return { handle, sent };
}

describe('LessonRunner', () => {
  function setup(reduceMotion = false) {
    const store = createBoardLabStore(initialState({ board: 'uno-r3', lesson: 'blink', language: 'arduino-cpp', template: BLINK }));
    const sched = new FakeScheduler();
    const figure = fakeFigure();
    let passed = 0;
    const runner = new LessonRunner({
      store,
      board: { id: 'uno-r3', name: 'Arduino Uno', logicV: 5 },
      lesson: { world: NO_WORLD, runMs: 4500, checks: [{ kind: 'pin-toggles', pin: 'D13', periodMs: [1900, 2100], minCycles: 1, label: 'c' }] },
      resetControls: ['RESET'],
      figure: () => figure.handle,
      reduceMotion: () => reduceMotion,
      onPassed: () => passed++,
      scheduler: sched,
    });
    const detach = runner.attach();
    return { store, sched, figure, detach, passed: () => passed };
  }

  it('compiles, uploads, then drives the figure and the serial monitor', async () => {
    const { store, sched, figure, passed } = setup();
    store.dispatch({ type: 'run/start' });
    await engineLoaded();
    expect(store.getState().run.status).toBe('compiling');
    sched.advance(620);
    expect(store.getState().run.status).toBe('uploading');
    sched.advance(620);
    expect(store.getState().run.status).toBe('running');
    expect(store.getState().serial.lines.filter((l) => l.kind === 'sys').map((l) => l.text)).toEqual(['upload.compiling', 'upload.uploading', 'upload.done']);
    // The check run starts right after the upload and reports when its run is done.
    sched.advance(20);
    await vi.waitFor(() => expect(store.getState().checks.passed).toBe(true));
    expect(store.getState().checks.progress).toBe(1);
    expect(passed()).toBe(1);

    sched.advance(500);
    const pinSets = () => figure.sent.filter((s) => 'pins' in s).map((s) => (s.pins as Record<string, number>).D13);
    expect(pinSets()).toContain(1);
    sched.advance(1000);
    expect(pinSets().slice(-1)[0]).toBe(0);
    const out = store.getState().serial.lines.filter((l) => l.kind === 'out').map((l) => l.text);
    expect(out.slice(0, 3)).toEqual(['Blink ready', 'on', 'off']);
    // The figure never gets more than 30 pin updates a second.
    expect(figure.sent.filter((s) => 'pins' in s).length).toBeLessThanOrEqual(Math.ceil((sched.t / 1000) * 30));
  });

  it('sends pins that never change once the figure is there, and again after it reloads', async () => {
    const store = createBoardLabStore(initialState({ board: 'uno-r3', lesson: 'blink', language: 'arduino-cpp', template: STEADY }));
    const sched = new FakeScheduler();
    const figure = fakeFigure();
    let present = false;
    const runner = new LessonRunner({
      store,
      board: { id: 'uno-r3', name: 'Arduino Uno', logicV: 5 },
      lesson: { world: NO_WORLD, runMs: 4500, checks: [] },
      resetControls: ['RESET'],
      figure: () => (present ? figure.handle : null),
      reduceMotion: () => true,
      onPassed: () => {},
      scheduler: sched,
    });
    runner.attach();
    store.dispatch({ type: 'run/start' });
    await engineLoaded();
    sched.advance(300);
    expect(store.getState().run.status).toBe('running');
    // Run was pressed while the figure was still loading: nothing reached it.
    present = true;
    sched.advance(100);
    expect(figure.sent.filter((s) => 'pins' in s)).toEqual([{ pins: { D13: 1 } }]);
    // The iframe reloads: the new page starts from scratch and needs the pins again.
    runner.figureReady();
    sched.advance(100);
    expect(figure.sent.filter((s) => 'pins' in s)).toEqual([{ pins: { D13: 1 } }, { pins: { D13: 1 } }]);
  });

  it('stops: the LED goes dark and the monitor says so', async () => {
    const { store, sched, figure } = setup(true);
    store.dispatch({ type: 'run/start' });
    await engineLoaded();
    sched.advance(100);
    expect(store.getState().run.status).toBe('running');
    sched.advance(300);
    store.dispatch({ type: 'run/stop' });
    expect(store.getState().run.status).toBe('stopped');
    const last = figure.sent.filter((s) => 'pins' in s).slice(-1)[0];
    expect(last).toEqual({ pins: { D13: 0 } });
    expect(store.getState().serial.lines.slice(-1)[0].text).toBe('upload.stopped');
  });

  it("tells the figure nothing is running once it stops, and once the code does not compile", async () => {
    const { store, sched, figure } = setup(true);
    store.dispatch({ type: 'run/start' });
    await engineLoaded();
    sched.advance(400);
    expect(figure.sent.some((s) => s.halted === true)).toBe(false);
    store.dispatch({ type: 'run/stop' });
    expect(figure.sent.slice(-1)[0]).toEqual({ halted: true });

    figure.sent.length = 0;
    store.dispatch({ type: 'code/replace', code: 'void loop() { @@bad( }' });
    store.dispatch({ type: 'run/start' });
    await engineLoaded();
    sched.advance(100);
    expect(store.getState().run.status).toBe('stopped');
    expect(figure.sent.slice(-1)[0]).toEqual({ halted: true });
  });

  it('cancels an upload that is stopped half way, without marking the lesson done', async () => {
    const { store, sched, passed } = setup();
    store.dispatch({ type: 'run/start' });
    await engineLoaded();
    sched.advance(700);
    store.dispatch({ type: 'run/stop' });
    sched.advance(2000);
    expect(store.getState().run.status).toBe('stopped');
    expect(passed()).toBe(0);
  });

  it('stays stopped when Stop comes before the engine has loaded', async () => {
    const { store, sched } = setup(true);
    store.dispatch({ type: 'run/start' });
    store.dispatch({ type: 'run/stop' });
    await engineLoaded();
    sched.advance(500);
    expect(store.getState().run.status).toBe('stopped');
    expect(store.getState().serial.lines.some((l) => l.text === 'upload.uploading')).toBe(false);
  });

  it('refuses to run on an unplugged board', async () => {
    const { store, sched } = setup();
    store.dispatch({ type: 'figure/state', state: { status: 'off' } });
    store.dispatch({ type: 'run/start' });
    await engineLoaded();
    sched.advance(2000);
    expect(store.getState().run.status).toBe('stopped');
    expect(store.getState().serial.lines.some((l) => l.text === 'refused.unplugged')).toBe(true);
  });

  it('holds the sketch in reset while RESET is pressed and restarts it at t = 0', async () => {
    const { store, sched } = setup(true);
    store.dispatch({ type: 'run/start' });
    await engineLoaded();
    sched.advance(100);
    sched.advance(1500);
    expect(store.getState().run.vt).toBeGreaterThan(1000);
    store.dispatch({ type: 'figure/state', state: { status: 'running', controls: { RESET: 1 } } });
    sched.advance(300);
    store.dispatch({ type: 'figure/state', state: { status: 'running', controls: { RESET: 0 } } });
    sched.advance(100);
    expect(store.getState().run.vt).toBeLessThan(300);
    expect(store.getState().serial.lines.some((l) => l.text === 'upload.reset')).toBe(true);
  });

  it('shows a compile error and stays stopped', async () => {
    const { store, sched } = setup(true);
    store.dispatch({ type: 'code/replace', code: BLINK.replace('delay(1000);', 'dely(1000);') });
    store.dispatch({ type: 'run/start' });
    await engineLoaded();
    sched.advance(500);
    const s = store.getState();
    expect(s.run.status).toBe('stopped');
    expect(s.run.error?.line).toBe(10);
    expect(s.serial.lines.some((l) => l.kind === 'err')).toBe(true);
  });
});
