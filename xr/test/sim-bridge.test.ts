/**
 * The sim bridge over the real handler, run inline in Node with a fake wall clock and a hand-drained pump. The project
 * is iynk's Uno Blink template, loaded and checked the way the headset loads it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import { builtinRegistry } from '@/parts/builtin';
import type { Project } from '@/project/generated/types';
import { validateValue } from '@/project/validate';
import { buildSimNetlist } from '@/sim/netlist';
import type { RunState, SimBridge } from '../src/contracts/sim';
import { createSimBridge, inlinePort } from '../src/sim/bridge';

let doc: Project;

beforeAll(async () => {
  const report = validateValue(await loadTemplate('prj_uno-r3-blink'));
  if (!report.ok || !report.doc) throw new Error('the Blink template did not load');
  doc = report.doc;
});

/** A bridge whose pump runs only when the test drains it, against a wall clock the test moves. */
function rig() {
  const tasks: Array<() => void> = [];
  const clock = { wall: 0 };
  const bridge = createSimBridge({ port: inlinePort({ wallMs: () => clock.wall, schedule: (fn) => void tasks.push(fn) }) });
  const states: RunState[] = [];
  const diagnostics: string[] = [];
  bridge.onState((s) => states.push(s));
  bridge.onDiagnostic((d) => diagnostics.push(`${d.kind}: ${d.message}`));
  /** Moves the wall clock by `ms` and runs the queued slices once; a live one simulates up to the paced target. */
  const tick = async (ms: number) => {
    clock.wall += ms;
    for (const task of tasks.splice(0)) task();
    await settle();
  };
  return { bridge, tasks, clock, states, diagnostics, tick };
}

/** Lets the inline port deliver its events (each crosses a microtask). */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const d13 = (b: SimBridge) => b.lastFrame?.pins.D13;
const led = (b: SimBridge) => {
  const s = b.lastFrame?.parts.get('cmp_led1');
  return s?.kind === 'led' ? s : undefined;
};

/** Blink: high in [0, 500) ms, low in [500, 1000), and so on. */
const blinkLevel = (ms: number) => (Math.floor(ms / 500) % 2 === 0 ? 1 : 0);

describe('the sim bridge on the Uno Blink template', () => {
  it('toggles D13 and the LED every 500 ms', async () => {
    const { bridge, diagnostics } = rig();
    const loaded = await bridge.load(doc);
    expect(loaded.ok).toBe(true);
    expect(loaded.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(bridge.lastFrame?.atNs).toBe(0);
    expect(bridge.lastFrame?.parts).toBeInstanceOf(Map);

    const samples: string[] = [];
    for (let ms = 100; ms <= 3000; ms += 100) {
      await bridge.step(100);
      if (ms % 500 === 0) continue; // the edge itself may land either side of the boundary
      const want = blinkLevel(ms);
      samples.push(`${ms}:${d13(bridge)}${led(bridge)?.lit ? '*' : ''}`);
      expect(d13(bridge), `D13 at ${ms} ms`).toBe(want);
      expect(led(bridge)?.lit, `LED at ${ms} ms`).toBe(want === 1);
    }
    expect(samples).toHaveLength(24);
    expect(diagnostics).toEqual([]);
    await bridge.dispose();
  });

  it('puts the edges within a millisecond of each 500 ms boundary', async () => {
    const { bridge } = rig();
    await bridge.load(doc);
    const at = async (ms: number, want: 0 | 1) => {
      expect(d13(bridge), `D13 at ${ms} ms`).toBe(want);
      expect(led(bridge)?.lit, `LED at ${ms} ms`).toBe(want === 1);
    };
    await bridge.step(499);
    await at(499, 1);
    await bridge.step(2);
    await at(501, 0);
    await bridge.step(498);
    await at(999, 0);
    await bridge.step(2);
    await at(1001, 1);
    await bridge.dispose();
  });

  it('moves through the run states, and runs again from the start after stop', async () => {
    const r = rig();
    const { bridge } = r;
    expect(bridge.state).toBe('unloaded');
    expect(bridge.lastFrame).toBeNull();
    await expect(bridge.run()).rejects.toThrow(/nothing is loaded/);
    await expect(bridge.stop()).resolves.toBeUndefined();

    await bridge.load(doc);
    expect(bridge.state).toBe('idle');

    let findingsPosts = 0;
    bridge.onFindings(() => findingsPosts++);
    await bridge.step(300);
    expect(bridge.state).toBe('paused');
    expect(findingsPosts).toBe(1);
    expect(bridge.findings).toEqual([]);

    // Run resumes from 300 ms, paced at 1 sim second per wall second.
    await bridge.run();
    expect(bridge.state).toBe('running');
    await r.tick(400); // to 700 ms: low
    expect(d13(bridge)).toBe(0);
    await bridge.pause();
    expect(bridge.state).toBe('paused');
    const pausedAt = bridge.lastFrame!.atNs;
    expect(pausedAt).toBe(700_000_000);

    await bridge.stop();
    expect(bridge.state).toBe('idle');
    expect(bridge.lastFrame?.atNs).toBe(0);

    await bridge.run();
    await r.tick(200); // 200 ms into the new run: high again
    expect(bridge.lastFrame!.atNs).toBeLessThanOrEqual(200_000_000);
    expect(d13(bridge)).toBe(1);
    expect(led(bridge)?.lit).toBe(true);

    // Stop while running pauses first, so the findings of the ending run are posted.
    const before = findingsPosts;
    await bridge.stop();
    expect(findingsPosts).toBe(before + 1);
    expect(r.states).toEqual(['idle', 'paused', 'running', 'paused', 'idle', 'running', 'paused', 'idle']);
    await bridge.dispose();
  });

  it('paces a run at the speed asked for, and keeps that speed for the next load', async () => {
    const r = rig();
    const { bridge } = r;
    await bridge.setSpeed(2); // before any load
    await bridge.load(doc);
    await bridge.run();
    await r.tick(100);
    await bridge.pause();
    expect(bridge.lastFrame!.atNs).toBe(200_000_000);

    await bridge.load(doc);
    await bridge.run();
    await r.tick(300); // 600 ms of sim: low
    await bridge.pause();
    expect(bridge.lastFrame!.atNs).toBe(600_000_000);
    expect(d13(bridge)).toBe(0);

    await bridge.setSpeed(1000);
    await bridge.run();
    await r.tick(1); // clamped to 100x: 100 ms more
    await bridge.pause();
    expect(bridge.lastFrame!.atNs).toBe(700_000_000);
    await bridge.dispose();
  });

  it('carries world inputs to the worker, and a part input reaches the circuit', async () => {
    const { bridge, diagnostics } = rig();
    await expect(bridge.input({ kind: 'pin', pin: 'D2', value: 1 })).resolves.toBeUndefined(); // ignored while unloaded
    await bridge.load(doc);
    await bridge.step(100);
    expect(led(bridge)?.lit).toBe(true);

    // A 1 Mohm resistor in place of the series one leaves D13 high but the LED dark.
    await expect(bridge.input({ kind: 'part', part: 'cmp_res1', path: 'ohms', value: 1e6 })).resolves.toBeUndefined();
    await bridge.step(100);
    expect(d13(bridge)).toBe(1);
    expect(led(bridge)?.lit).toBe(false);

    await expect(bridge.input({ kind: 'pin', pin: 'D2', value: 1 })).resolves.toBeUndefined();
    await expect(bridge.input({ kind: 'pin', pin: 'D2', value: null })).resolves.toBeUndefined();
    await expect(bridge.input({ kind: 'analog', pin: 'A0', volts: 2.5 })).resolves.toBeUndefined();
    await expect(bridge.input({ kind: 'serial', text: 'hi\n' })).resolves.toBeUndefined();
    await expect(bridge.input({ kind: 'part', part: 'cmp_res1', path: 'ohms', value: Number.NaN })).rejects.toThrow(RangeError);
    await bridge.step(100);
    expect(diagnostics).toEqual([]);
    await bridge.dispose();
  });

  it('reads a meter on the LED from the circuit solver', async () => {
    const { bridge } = rig();
    await bridge.load(doc);
    await bridge.step(100);
    const { net } = buildSimNetlist(doc, builtinRegistry());
    const pins = net.parts.find((p) => p.id === 'cmp_led1')!.pins;
    const anode = Object.values(pins).find((n) => n !== null)!;
    const reading = await bridge.meter('m1', { mode: 'dc-amps' }, { red: anode, black: null, element: 'cmp_led1' });
    expect(reading.value).toBeGreaterThan(0.001);
    expect(reading.value).toBeLessThan(0.03);
    await bridge.dispose();
  });

  it('reports a refused load as the error state, and loads again after it', async () => {
    const { bridge } = rig();
    const broken: Project = { ...doc, sources: doc.sources.map((s) => ({ ...s, content: 'void setup() { int x = ; }\nvoid loop() { }\n' })) };
    const refused = await bridge.load(broken);
    expect(refused.ok).toBe(false);
    expect(refused.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(bridge.state).toBe('error');
    await expect(bridge.run()).rejects.toThrow();
    await expect(bridge.step(100)).rejects.toThrow();

    expect((await bridge.load(doc)).ok).toBe(true);
    expect(bridge.state).toBe('idle');
    await bridge.step(100);
    expect(d13(bridge)).toBe(1);
    await bridge.dispose();
    await expect(bridge.step(100)).rejects.toThrow(/disposed/);
  });
});
