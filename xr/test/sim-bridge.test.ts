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
import type { AnalogWatch, ProbeSpec, RunState, SimBridge, SimNetlist } from '../src/contracts/sim';
import { createProjectStore } from '../src/project/store';
import { createSimBridge, inlinePort } from '../src/sim/bridge';

let doc: Project;
/** Blink with its series resistor taken out by ops, so D13 drives the LED's anode directly. */
let bare: Project;

beforeAll(async () => {
  const report = validateValue(await loadTemplate('prj_uno-r3-blink'));
  if (!report.ok || !report.doc) throw new Error('the Blink template did not load');
  doc = report.doc;
  const store = createProjectStore(doc);
  const applied = store.apply([
    { k: 'component.remove', id: 'cmp_res1' },
    { k: 'net.connect', net: 'net_d13', pin: { c: 'cmp_led1', p: 'A' }, move: true },
  ]);
  if (!applied.ok) throw new Error(`the ops did not apply: ${JSON.stringify(applied)}`);
  bare = store.doc;
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

/** The net D13 sits on, from the netlist of the loaded run. */
const d13Net = (net: SimNetlist) => net.parts.find((p) => p.kind === 'board')!.pins.D13!;

const SCOPE = 'scope-d13';
const voltageProbe = (target: string, id = SCOPE): ProbeSpec => ({ id, kind: 'voltage', target, capacity: 4096, envelope: false });
const scopeWatch = (...waves: string[]): AnalogWatch => ({ volts: [], amps: [], pinAmps: false, waves });

/** Every wave sample of probe `id` the frames carry, by simulated ms. A later frame's sample for the same instant wins. */
function traceOf(b: SimBridge, id: string) {
  const trace = new Map<number, number>();
  let frames = 0;
  const off = b.onFrame((f) => {
    const w = f.analog?.waves?.[id];
    if (!w) return;
    frames++;
    w.v.forEach((v, k) => trace.set((w.fromNs + k * w.stepNs) / 1_000_000, v));
  });
  return {
    trace,
    frames: () => frames,
    off,
  };
}

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

describe('the netlist of the run', () => {
  it('is null before a load, the loaded document after one, and null again after a refused load', async () => {
    const { bridge } = rig();
    expect(bridge.netlist).toBeNull();

    const atIdle: Array<SimNetlist | null> = [];
    bridge.onState((s) => s === 'idle' && atIdle.push(bridge.netlist));
    expect((await bridge.load(doc)).ok).toBe(true);
    const { net } = buildSimNetlist(doc, builtinRegistry());
    expect(bridge.netlist).toEqual(net);
    expect(atIdle).toEqual([net]); // already set when the state says idle
    expect(bridge.netlist!.parts.map((p) => p.id)).toContain('cmp_res1');

    // A later load replaces it.
    expect((await bridge.load(bare)).ok).toBe(true);
    expect(bridge.netlist!.docHash).toBe(buildSimNetlist(bare, builtinRegistry()).net.docHash);
    expect(bridge.netlist!.parts.map((p) => p.id)).not.toContain('cmp_res1');

    // Refused by the worker (the sketch does not compile), then by the bridge (no firmware).
    const broken: Project = { ...doc, sources: doc.sources.map((s) => ({ ...s, content: 'void setup() { int x = ; }\nvoid loop() { }\n' })) };
    expect((await bridge.load(broken)).ok).toBe(false);
    expect(bridge.netlist).toBeNull();
    expect((await bridge.load(doc)).ok).toBe(true);
    expect(bridge.netlist).toEqual(net);
    const noFirmware: Project = { ...doc, boards: doc.boards.map(({ firmware: _, ...b }) => b) };
    expect((await bridge.load(noFirmware)).ok).toBe(false);
    expect(bridge.netlist).toBeNull();
    await bridge.dispose();
  });
});

describe('the static check', () => {
  const ledSeries = (findings: readonly { ruleId: string; args: object }[]) => findings.filter((f) => f.ruleId === 'rule:led-series@1');

  it('finds an LED with no series resistor, and nothing of the kind in Blink', async () => {
    const { bridge } = rig();
    const found = await bridge.check(bare);
    expect(ledSeries(found.findings)).toEqual([
      expect.objectContaining({ causeId: 'led-no-series-resistor', args: { led: 'cmp_led1', source: 'brd_main.D13' } }),
    ]);
    expect(ledSeries((await bridge.check(doc)).findings)).toEqual([]);
    expect(bridge.state).toBe('unloaded'); // a check needs no run and makes none
    expect(bridge.netlist).toBeNull();
    await bridge.dispose();
    await expect(bridge.check(doc)).rejects.toThrow(/disposed/);
  });

  it('checks a document the load would refuse', async () => {
    const { bridge } = rig();
    const odd: Project = {
      ...bare,
      boards: bare.boards.map(({ firmware: _, ...b }) => b),
      components: [...bare.components, { id: 'cmp_mystery', refdes: 'X1', definition: { ref: 'core.no-such-part', version: '1.0.0' } }],
    };
    expect(buildSimNetlist(odd, builtinRegistry()).diagnostics.map((d) => d.id)).toContain('unknown-part');
    expect(ledSeries((await bridge.check(odd)).findings)).toHaveLength(1);
    expect((await bridge.load(odd)).ok).toBe(false);
    await bridge.dispose();
  });

  it('leaves the current run where it was', async () => {
    const { bridge, diagnostics } = rig();
    await bridge.load(doc);
    await bridge.step(300);
    const net = bridge.netlist;
    let frames = 0;
    bridge.onFrame(() => frames++);
    expect(ledSeries((await bridge.check(bare)).findings)).toHaveLength(1);
    expect(frames).toBe(0);
    expect(bridge.state).toBe('paused');
    expect(bridge.netlist).toBe(net);
    expect(bridge.lastFrame!.atNs).toBe(300_000_000);

    await bridge.step(300);
    expect(bridge.lastFrame!.atNs).toBe(600_000_000);
    expect(d13(bridge)).toBe(0);
    expect(led(bridge)?.lit).toBe(false);
    expect(diagnostics).toEqual([]);
    await bridge.dispose();
  });
});

describe('scope probes', () => {
  it('needs a loaded run', async () => {
    const { bridge } = rig();
    await expect(bridge.addProbe(voltageProbe('n0'))).rejects.toThrow(/nothing is loaded/);
    await expect(bridge.removeProbe(SCOPE)).resolves.toBeUndefined();
    const broken: Project = { ...doc, sources: doc.sources.map((s) => ({ ...s, content: 'void loop( {' })) };
    await bridge.load(broken);
    await expect(bridge.addProbe(voltageProbe('n0'))).rejects.toThrow(/did not load/);
    await expect(bridge.removeProbe(SCOPE)).resolves.toBeUndefined();
    await bridge.dispose();
  });

  it('streams a voltage probe on D13 in frames, high and low with the blink', async () => {
    const { bridge } = rig();
    await bridge.load(doc);
    const added = await bridge.addProbe(voltageProbe(d13Net(bridge.netlist!)));
    expect(added).toEqual({ id: SCOPE });
    const scope = traceOf(bridge, SCOPE);
    await bridge.watchAnalog(scopeWatch(SCOPE));
    // 70 ms steps never end on an edge. An edge exactly at the end of a step is stamped at that end, which the next
    // frame's delta has already passed, so only the full frame after it shows the edge (iynk's tap and frame cursor).
    for (let ms = 70; ms <= 2100; ms += 70) await bridge.step(70);

    expect(scope.frames()).toBeGreaterThanOrEqual(30);
    const samples = [...scope.trace].filter(([ms]) => ms % 500 > 5 && ms % 500 < 495); // clear of the edges
    expect(samples.length).toBeGreaterThan(400);
    const high = samples.filter(([ms]) => blinkLevel(ms) === 1);
    const low = samples.filter(([ms]) => blinkLevel(ms) === 0);
    expect(high.length).toBeGreaterThan(100);
    expect(low.length).toBeGreaterThan(100);
    for (const [ms, v] of high) expect(v, `D13 at ${ms} ms`).toBeGreaterThan(4);
    for (const [ms, v] of low) expect(v, `D13 at ${ms} ms`).toBeLessThan(0.5);
    expect(Math.max(...scope.trace.keys())).toBe(2100);
    await bridge.dispose();
  });

  it('passes on what the run refuses, and removes a probe', async () => {
    const { bridge } = rig();
    await bridge.load(doc);
    const net = d13Net(bridge.netlist!);
    expect(await bridge.addProbe(voltageProbe(net))).toEqual({ id: SCOPE });
    expect(await bridge.addProbe(voltageProbe(net))).toEqual({ id: SCOPE, error: 'unknown-target' });
    expect(await bridge.addProbe(voltageProbe('', 'empty'))).toEqual({ id: 'empty', error: 'unknown-target' });
    for (let i = 1; i < 64; i++) expect((await bridge.addProbe(voltageProbe(net, `p${i}`))).error).toBeUndefined();
    expect(await bridge.addProbe(voltageProbe(net, 'p64'))).toEqual({ id: 'p64', error: 'too-many-probes' });

    const scope = traceOf(bridge, SCOPE);
    await bridge.watchAnalog(scopeWatch(SCOPE));
    await bridge.step(100);
    expect(bridge.lastFrame!.analog?.waves?.[SCOPE]?.v.length).toBeGreaterThan(0);

    await bridge.removeProbe(SCOPE);
    await bridge.step(100);
    await bridge.step(100);
    expect(bridge.lastFrame!.analog?.waves?.[SCOPE]).toBeUndefined();
    expect(Math.max(...scope.trace.keys())).toBeLessThanOrEqual(100);
    await expect(bridge.removeProbe(SCOPE)).resolves.toBeUndefined(); // already gone
    await expect(bridge.removeProbe('never-added')).resolves.toBeUndefined();

    // The slot is free again.
    expect(await bridge.addProbe(voltageProbe(net, 'p64'))).toEqual({ id: 'p64' });
    await bridge.dispose();
    await expect(bridge.addProbe(voltageProbe(net))).rejects.toThrow(/disposed/);
    await expect(bridge.removeProbe(SCOPE)).rejects.toThrow(/disposed/);
  });

  it('loses its probes on stop and on load, and keeps them over pause, step and check', async () => {
    const r = rig();
    const { bridge } = r;
    await bridge.load(doc);
    const net = d13Net(bridge.netlist!);
    await bridge.addProbe(voltageProbe(net));
    await bridge.watchAnalog(scopeWatch(SCOPE));
    await bridge.run();
    await r.tick(200);
    await bridge.pause();
    await bridge.step(100);
    await bridge.check(bare);
    expect(bridge.lastFrame!.analog?.waves?.[SCOPE]).toBeDefined();
    expect(await bridge.addProbe(voltageProbe(net))).toEqual({ id: SCOPE, error: 'unknown-target' }); // still there

    // Stop rebuilds the run without its probes; the watch is sent again, so adding the probe again is enough.
    await bridge.stop();
    await bridge.step(100);
    expect(bridge.lastFrame!.analog?.waves?.[SCOPE]).toBeUndefined();
    expect(await bridge.addProbe(voltageProbe(net))).toEqual({ id: SCOPE });
    await bridge.step(100);
    const wave = bridge.lastFrame!.analog?.waves?.[SCOPE];
    expect(wave?.v.length).toBeGreaterThan(0);
    expect(Math.min(...wave!.v)).toBeGreaterThan(4); // 100 to 200 ms of the new run: high

    // A load clears the probes but the bridge sends the watch again, so adding the probe again is enough.
    await bridge.load(doc);
    expect(await bridge.addProbe(voltageProbe(net))).toEqual({ id: SCOPE });
    await bridge.step(100);
    expect(bridge.lastFrame!.analog?.waves?.[SCOPE]?.v.length).toBeGreaterThan(0);
    await bridge.dispose();
  });
});
