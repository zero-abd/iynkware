/**
 * Robot physics through the sim bridge: iynk's drive-base and line-follower templates run inline in Node on the same
 * handler the headset's worker builds (interpreter, circuit solver, rapier), and their physics frames come out of the
 * bridge. A board project still runs with no physics at all.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import type { Project } from '@/project/generated/types';
import { validateValue } from '@/project/validate';
import type { MechStatus, PhysicsFrame } from '../src/contracts/sim';
import { createSimBridge, inlinePort } from '../src/sim/bridge';

const robot = (name: string): Project => {
  const report = validateValue(JSON.parse(readFileSync(new URL(`../../content/projects/robots/${name}.project.json`, import.meta.url), 'utf8')));
  if (!report.ok || !report.doc) throw new Error(`the ${name} template did not pass the project schema`);
  return report.doc;
};

/** A bridge whose pump runs only when the test drains it. */
function rig() {
  const tasks: Array<() => void> = [];
  const bridge = createSimBridge({ port: inlinePort({ wallMs: () => 0, schedule: (fn) => void tasks.push(fn) }) });
  const frames: PhysicsFrame[] = [];
  const states: MechStatus[] = [];
  bridge.onMech((f) => frames.push(f));
  bridge.onMechState((s) => states.push(s));
  return { bridge, frames, states };
}

const at = (frames: PhysicsFrame[], seconds: number) => frames.find((f) => f.atNs >= seconds * 1e9);

describe('robot physics frames on the sim bridge', () => {
  it('drive base: the chassis drives forward for 2 s, frame by frame', async () => {
    const { bridge, frames, states } = rig();
    const loaded = await bridge.load(robot('drive-base'));
    expect(loaded.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(loaded.ok).toBe(true);
    expect(states.map((s) => s.state)).toContain('ready');
    for (let k = 0; k < 25; k++) await bridge.step(100);
    // A paused run stepped by hand posts one physics frame per step; a running one posts 30 per simulated second.
    expect(frames.length).toBeGreaterThanOrEqual(25);
    expect(bridge.lastMech).toBe(frames.at(-1));
    const start = at(frames, 0)!.bodies.bdy_chassis!;
    const two = at(frames, 2)!.bodies.bdy_chassis!;
    expect(two.p[0] - start.p[0]).toBeGreaterThan(0.5);
    expect(Math.abs(two.p[1] - start.p[1])).toBeLessThan(0.02);
    await bridge.dispose();
  });

  it('line follower, running against the wall clock: at most 30 frames a second, and it follows the oval', async () => {
    const tasks: Array<() => void> = [];
    const clock = { wall: 0 };
    const bridge = createSimBridge({ port: inlinePort({ wallMs: () => clock.wall, schedule: (fn) => void tasks.push(fn) }) });
    const frames: PhysicsFrame[] = [];
    bridge.onMech((f) => frames.push(f));
    expect((await bridge.load(robot('line-follower'))).ok).toBe(true);
    await bridge.run();
    for (let k = 0; k < 20; k++) {
      clock.wall += 100;
      for (const task of tasks.splice(0)) task();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const seconds = (frames.at(-1)!.atNs - frames[0]!.atNs) / 1e9;
    expect(seconds).toBeGreaterThan(1.5);
    // The host posts at most one physics frame per 1/30 s bucket and at least one per slice; here every slice covers
    // 100 ms of wall clock, so about ten a second arrive (the worker's slices are a few ms, so it nears 30 there).
    expect(frames.length).toBeGreaterThanOrEqual(19);
    expect(frames.length / seconds).toBeLessThanOrEqual(31);
    const start = frames[0]!.bodies.bdy_chassis!;
    const end = frames.at(-1)!.bodies.bdy_chassis!;
    // It starts on the oval's east end heading north and curves round to the west.
    expect(Math.hypot(end.p[0] - start.p[0], end.p[1] - start.p[1])).toBeGreaterThan(0.3);
    expect(Math.abs(end.yawRad - start.yawRad)).toBeGreaterThan(0.3);
    await bridge.dispose();
  });

  it('a board project loads and runs with no physics', async () => {
    const report = validateValue(await loadTemplate('prj_uno-r3-blink'));
    const { bridge, frames, states } = rig();
    expect((await bridge.load(report.doc!)).ok).toBe(true);
    await bridge.step(600);
    expect(bridge.lastFrame?.pins.D13).toBe(0);
    expect(frames).toEqual([]);
    expect(states).toEqual([]);
    expect(bridge.lastMech).toBeNull();
    await bridge.dispose();
  });
});
