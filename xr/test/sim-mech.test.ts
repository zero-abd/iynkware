/**
 * Robot physics on the sim bridge: iynk's drive-base template run through the real handler inline in Node (rapier
 * from the npm compat build, imported lazily by handler-deps), and the bridge's mapping of the mech events checked on
 * a scripted port.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import type { Project } from '@/project/generated/types';
import { validateValue } from '@/project/validate';
import type { Ack } from '@/protocol';
import type { SimEv, SimReq } from '@/sim-host/protocol';
import type { MechStatus, PhysicsFrame } from '../src/contracts/sim';
import { createSimBridge, inlinePort, type SimPort } from '../src/sim/bridge';

const robot = (name: string): Project =>
  JSON.parse(readFileSync(new URL(`../../content/projects/robots/${name}.project.json`, import.meta.url), 'utf8')) as Project;

let blink: Project;

beforeAll(async () => {
  const report = validateValue(await loadTemplate('prj_uno-r3-blink'));
  if (!report.ok || !report.doc) throw new Error('the Blink template did not load');
  blink = report.doc;
});

/** The inline handler behind a port that records what the bridge sends. */
function recorded() {
  const inner = inlinePort({ wallMs: () => 0, schedule: () => undefined });
  const sent: SimReq[] = [];
  const port: SimPort = { ...inner, call: (msg, o) => (sent.push(msg), inner.call(msg, o)) };
  return { port, sent };
}

const chassis = (frame: PhysicsFrame | null) => frame?.bodies.bdy_chassis;

describe('robot physics on the sim bridge', () => {
  it('drive base: loads physics, and the chassis drives forward in the frames', async () => {
    const { port, sent } = recorded();
    const bridge = createSimBridge({ port });
    const states: MechStatus[] = [];
    let frames = 0;
    bridge.onMechState((s) => states.push(s));
    bridge.onMech(() => frames++);

    const loaded = await bridge.load(robot('drive-base'));
    expect(loaded.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(loaded.ok).toBe(true);
    expect(sent.find((m) => m.t === 'load')).toHaveProperty('robot');
    expect(states.map((s) => s.state)).toEqual(['loading-physics', 'ready']);
    const start = chassis(bridge.lastMech)!;
    expect(bridge.lastMech!.atNs).toBe(0);

    for (let ms = 0; ms < 2000; ms += 100) await bridge.step(100);
    const at2s = bridge.lastMech!;
    expect(at2s.atNs).toBeGreaterThan(1.9e9);
    expect(chassis(at2s)!.p[0] - start.p[0]).toBeGreaterThan(0.5);
    expect(Math.abs(chassis(at2s)!.p[1] - start.p[1])).toBeLessThan(0.02);
    expect(frames).toBeGreaterThanOrEqual(20);

    // Stop rebuilds the run at t = 0, with the chassis back at the start.
    await bridge.stop();
    expect(bridge.lastMech!.atNs).toBe(0);
    expect(chassis(bridge.lastMech)!.p).toEqual(start.p);

    // A board project after it: no robot sent, no physics state, and the old run's frames are gone.
    const before = { frames, states: states.length };
    expect((await bridge.load(blink)).ok).toBe(true);
    expect(sent.filter((m) => m.t === 'load').at(-1)).not.toHaveProperty('robot');
    expect(bridge.lastMech).toBeNull();
    await bridge.step(200);
    expect(bridge.lastMech).toBeNull();
    expect({ frames, states: states.length }).toEqual(before);
    await bridge.dispose();
  });

  it('a second robot load in the same worker does not load physics again', async () => {
    const bridge = createSimBridge({ port: inlinePort({ wallMs: () => 0, schedule: () => undefined }) });
    const states: string[] = [];
    bridge.onMechState((s) => states.push(s.state));
    expect((await bridge.load(robot('line-follower'))).ok).toBe(true);
    expect(states).toEqual(['ready']);
    expect(Object.keys(bridge.lastMech!.bodies)).toContain('bdy_chassis');
    await bridge.dispose();
  });
});

/** A port that answers every call and lets the test post the worker's events by hand. */
function scripted() {
  const fns = new Set<(ev: SimEv) => void>();
  const sent: SimReq[] = [];
  const port: SimPort = {
    call: async (msg) => (sent.push(msg), { v: 1, id: sent.length, t: 'ack', result: { diagnostics: [] } } as Ack),
    on: (fn) => (fns.add(fn), () => void fns.delete(fn)),
    kill: async () => undefined,
    state: 'ready',
    dropped: 0,
  };
  const post = (ev: SimEv) => fns.forEach((fn) => fn(ev));
  const runId = () => (sent.findLast((m) => m.t === 'load') as Extract<SimReq, { t: 'load' }>).run;
  return { port, post, runId };
}

const frameAt = (atNs: number, x: number): PhysicsFrame => ({ atNs, bodies: { bdy_chassis: { p: [x, 0, 0], yawRad: 0 } } });

describe('the bridge maps the mech events', () => {
  it('forwards frames as they arrive, one failed per refusal, a halt as failed with its code, and drops other runs', async () => {
    const { port, post, runId } = scripted();
    const bridge = createSimBridge({ port });
    const states: MechStatus[] = [];
    const seen: PhysicsFrame[] = [];
    bridge.onMechState((s) => states.push(s));
    bridge.onMech((f) => seen.push(f));
    await bridge.load(robot('drive-base'));
    const run = runId();

    post({ t: 'mech_status', run, state: 'loading-physics', wireBytes: 1234 });
    post({ t: 'mech_status', run, state: 'ready' });
    const f = frameAt(1e6, 0.1);
    post({ t: 'mech_frame', run, frame: f });
    expect(bridge.lastMech).toBe(f);
    post({ t: 'mech_frame', run: run + 7, frame: frameAt(2e6, 9) });
    post({ t: 'mech_status', run: run + 7, state: 'ready' });
    expect(bridge.lastMech).toBe(f);

    post({ t: 'mech_status', run, state: 'failed', reason: 'invalid-robot' });
    post({ t: 'mech_status', run, state: 'failed', reason: '2 robot errors', refusal: { code: 'invalid-robot', message: '2 robot errors' } });
    const last = frameAt(3e6, 0.2);
    post({ t: 'mech_halt', run, code: 'physics-diverged', body: 'bdy_chassis', at: 3e6, frame: last });
    expect(bridge.lastMech).toBe(last);
    expect(seen).toEqual([f, last]);
    expect(states).toEqual([
      { state: 'loading-physics', wireBytes: 1234 },
      { state: 'ready' },
      { state: 'failed', reason: '2 robot errors', code: 'invalid-robot' },
      { state: 'failed', reason: 'physics-diverged on bdy_chassis', code: 'physics-diverged', body: 'bdy_chassis' },
    ]);
    await bridge.dispose();
  });
});
