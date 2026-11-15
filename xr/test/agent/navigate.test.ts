/** The agent's way around (src/agent/tools/navigate.ts): names to destinations, and the tools over a fake host. */
import { describe, expect, it } from 'vitest';
import { destinationOf, NAV_RUNS, type Destination, type NavHost } from '../../src/agent/tools/navigate';
import { intentOf } from '../../src/agent/bridge/scripted';
import type { ToolHost } from '../../src/agent/tools/catalog';

const projects = () => [{ id: 'p1', title: 'My Robot Car' }];
const at = (w: string) => destinationOf(w, { projects });

describe('destinations by name', () => {
  it('finds labs, the drone, the bench, Home, templates and saved projects', () => {
    expect(at('my signals and systems lab')).toEqual({ kind: 'lab', lab: 'signals' });
    expect(at('the chemistry lab')).toEqual({ kind: 'lab', lab: 'chemistry' });
    expect(at('the drone project')).toEqual({ kind: 'drone' });
    expect(at('workbench')).toEqual({ kind: 'bench' });
    expect(at('home')).toEqual({ kind: 'home' });
    expect(at('servo')).toEqual(expect.objectContaining({ kind: 'template', id: 'prj_uno-r3-servo' }));
    expect(at('blink project')).toEqual(expect.objectContaining({ kind: 'template', id: 'prj_uno-r3-blink' }));
    expect(at('my robot car')).toEqual({ kind: 'project', id: 'p1', title: 'My Robot Car' });
    expect(at('the moon')).toBeNull();
  });

  it('tells the drone workbench from flying the drone and from the circuit bench', () => {
    for (const w of ['drone workbench', 'the drone bench', 'back to the drone workbench', 'build the drone', 'assemble the quad', 'test the drone motors', 'Drohnenwerkbank']) {
      expect(at(w)).toEqual({ kind: 'droneBench' });
    }
    for (const w of ['fly the drone', 'drone fly test', 'the drone flight range', 'range', 'drone', 'the drone project']) expect(at(w)).toEqual({ kind: 'drone' });
    for (const w of ['workbench', 'circuit bench', 'circuit']) expect(at(w)).toEqual({ kind: 'bench' });
    expect(at('tiny whoop bench')).toEqual(expect.objectContaining({ kind: 'craft', at: 'bench' }));
    expect(at('long range')).toEqual(expect.objectContaining({ kind: 'craft', id: 'prj_drone-longrange' }));
    expect(at('long range drone bench')).toEqual(expect.objectContaining({ kind: 'craft', id: 'prj_drone-longrange', at: 'bench' }));
    expect(at('tiny whoop')).not.toEqual(expect.objectContaining({ at: 'bench' }));
    expect(at('tiny whoop')).toEqual(expect.objectContaining({ kind: 'craft' }));
  });

  it('typed drone requests go to the drone, not the circuit build', () => {
    expect(intentOf('build the drone')).toEqual({ kind: 'go', where: 'build the drone' });
    expect(intentOf('fly the drone')).toEqual({ kind: 'go', where: 'fly the drone' });
    expect(intentOf('go to the drone workbench')).toEqual({ kind: 'go', where: 'the drone workbench' });
    expect(intentOf('build blink with me')).toEqual(expect.objectContaining({ kind: 'build' }));
  });

  it('typed requests become go_to', () => {
    expect(intentOf('go to the drone project')).toEqual({ kind: 'go', where: 'the drone project' });
    expect(intentOf('switch to my signals and systems lab')).toEqual({ kind: 'go', where: 'my signals and systems lab' });
    expect(intentOf('Open the chemistry lab')).toEqual({ kind: 'open', lab: 'chemistry' });
  });
});

describe('go_to and the controls', () => {
  const setup = () => {
    const went: Destination[] = [];
    let on = false;
    const nav: NavHost = {
      projects,
      go: async (d) => (went.push(d), true),
      controls: () => [{ id: 'agent/voice', label: 'Voice', on }, { id: 'lab/leave', label: 'Leave the lab' }],
      runControl: (id) => (id === 'agent/voice' ? ((on = !on), true) : id === 'lab/leave'),
      where: () => ({ place: 'bench', lab: null, project: 'x' }),
    };
    const h = { lang: () => 'en', nav } as unknown as ToolHost;
    return { h, went };
  };

  it('goes where it is asked, and says what it knows when it cannot', async () => {
    const { h, went } = setup();
    expect((await NAV_RUNS.go_to!(h, { where: 'signals lab' })).ok).toBe(true);
    expect((await NAV_RUNS.go_to!(h, { where: 'drone' })).ok).toBe(true);
    expect((await NAV_RUNS.go_to!(h, { where: 'drone workbench' })).ok).toBe(true);
    expect(went).toEqual([{ kind: 'lab', lab: 'signals' }, { kind: 'drone' }, { kind: 'droneBench' }]);
    const r = await NAV_RUNS.go_to!(h, { where: 'the moon' });
    expect(r.ok).toBe(false);
    expect(r.try).toEqual(expect.arrayContaining(['drone', 'signals lab']));
  });

  it('lists and presses menu buttons by name', async () => {
    const { h } = setup();
    expect((await NAV_RUNS.list_controls!(h, {})).controls).toHaveLength(2);
    expect(await NAV_RUNS.use_control!(h, { control: 'voice' })).toEqual(expect.objectContaining({ ok: true, ran: 'Voice', now: true }));
    expect((await NAV_RUNS.use_control!(h, { control: 'nope' })).ok).toBe(false);
  });
});
