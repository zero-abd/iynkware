/** The scene brief (src/agent/knowledge), the drone routes of go_to, and the Assist / Build gate on the tools. */
import { describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import { createAssistantService, instantPresence } from '../../src/assistant/service';
import { createProjectStore, createTemplateSource } from '../../src/project/store';
import { createLabContext } from '../../src/lab/context';
import { EXPERIMENTS } from '../../src/lab/experiments/list';
import { l6Problems } from '../../src/lab/text';
import { createCalloutList, createConversation } from '../../src/agent/bubbles/model';
import { createBridge } from '../../src/agent/bridge/bridge';
import { scriptedBrain } from '../../src/agent/bridge/scripted';
import { createCoach } from '../../src/agent/coach/coach';
import { catalogue, droneCrafts, labBrief, sceneBrief, sceneOf } from '../../src/agent/knowledge';
import { AGENT_TEXT } from '../../src/agent/text';
import { callTool, CHANGES, createTools, lookNow, RUN_NAMES, type CompanionMode, type ToolHost } from '../../src/agent/tools/catalog';
import { destinationOf, NAV_RUNS, type NavHost } from '../../src/agent/tools/navigate';

describe('scene brief', () => {
  it('knows the scene from where the person is', () => {
    expect(sceneOf({ place: 'bench', lab: 'chemistry' })).toBe('lab:chemistry');
    expect(sceneOf({ place: 'bench', lab: null, home: true })).toBe('home');
    expect(sceneOf({ place: 'range', lab: null })).toBe('range');
    expect(sceneOf({ place: 'bench', lab: null })).toBe('bench');
  });

  it('a lab brief has every experiment of that lab with goal and steps, and each item with what it is and safe use', () => {
    const b = labBrief('chemistry', 'en');
    const ids = EXPERIMENTS.filter((e) => e.lab === 'chemistry').map((e) => e.id);
    expect(b.experiments.map((e) => e.id)).toEqual(ids);
    for (const e of b.experiments) {
      expect(e.goal.length).toBeGreaterThan(10);
      expect(e.steps.length).toBeGreaterThan(1);
    }
    const ph = b.items.find((i) => i.kind === 'ph-meter')!;
    expect(ph.summary.length).toBeGreaterThan(20);
    expect(ph.summary.toLowerCase()).not.toBe(ph.name.toLowerCase());
    expect(ph.actions.length).toBeGreaterThan(0);
    expect(new Set(b.items.map((i) => i.kind)).size).toBe(b.items.length);
  });

  it('the index names every lab, the drone crafts and the projects, in the asked language', () => {
    const c = catalogue('de');
    expect(c.labs.map((l) => l.id)).toEqual(['chemistry', 'physics', 'electrical', 'signals']);
    expect(c.labs[0]!.name).toBe('Chemielabor');
    expect(c.drones.length).toBeGreaterThan(3);
    expect(c.drones[0]!.id).toBe('prj_drone-quad5');
    expect(c.projects.count).toBeGreaterThan(10);
  });

  it('only the open lab is in full: elsewhere the brief is the index', () => {
    expect(sceneBrief({ place: 'bench', lab: 'physics' }, 'en').lab?.id).toBe('physics');
    expect(sceneBrief({ place: 'range', lab: null }, 'en').lab).toBeUndefined();
    const bench = JSON.stringify(sceneBrief({ place: 'bench', lab: null }, 'en'));
    const lab = JSON.stringify(sceneBrief({ place: 'bench', lab: 'chemistry' }, 'en'));
    expect(bench.length).toBeLessThan(lab.length);
    expect(lab.length).toBeLessThan(20_000);
  });

  it('mode strings are in six languages', () => {
    expect(l6Problems(AGENT_TEXT.mode)).toEqual([]);
  });
});

describe('drones by name', () => {
  const at = (w: string) => destinationOf(w, { projects: () => [] });

  it('"drones" lists, a name opens that craft, "the drone" stays the quad', () => {
    expect(at('go to the drone projects')).toEqual({ kind: 'drones' });
    expect(at('drones')).toEqual({ kind: 'drones' });
    expect(at('which drones can I fly')).toEqual({ kind: 'drones' });
    // the drone with no place word opens on its workbench, wherever the person is
    expect(at('the drone project')).toEqual({ kind: 'droneHere' });
    expect(at('tiny whoop')).toEqual(expect.objectContaining({ kind: 'craft', id: 'prj_drone-whoop' }));
    expect(at('the racer drone')).toEqual(expect.objectContaining({ kind: 'craft', id: 'prj_drone-racer' }));
  });

  it('go_to drones names them and opens nothing', async () => {
    const went: unknown[] = [];
    const nav: NavHost = { projects: () => [], go: async (d) => (went.push(d), true), controls: () => [], runControl: () => false, where: () => ({ place: 'bench', lab: null, project: 'x' }) };
    const r = await NAV_RUNS.go_to!({ lang: () => 'en', nav } as unknown as ToolHost, { where: 'drone projects' });
    expect(r.ok).toBe(true);
    expect(r.drones).toEqual(droneCrafts('en').map((c) => c.title));
    expect(went).toEqual([]);
  });
});

describe('assist and build', () => {
  async function setup() {
    const project = createProjectStore(await loadTemplate('prj_uno-r3-blink'));
    const assistant = createAssistantService({ project, templates: createTemplateSource(), lang: () => 'en', presence: instantPresence });
    const lab = createLabContext(() => 'en');
    const coach = createCoach(() => 0);
    let mode: CompanionMode = 'assist';
    const host: ToolHost = {
      lang: () => 'en',
      assistant,
      project,
      guide: () => null,
      lab: () => lab,
      callouts: createCalloutList(() => 0),
      conversation: createConversation(),
      observations: (n) => coach.recent(n),
      mode: () => mode,
      setMode: (m) => (mode = m),
    };
    const tools = createTools(host);
    return { host, lab, call: (n: string, a: unknown = {}) => callTool(tools, n, a), setMode: (m: CompanionMode) => (mode = m) };
  }

  it('every gated tool exists', () => {
    for (const n of CHANGES) expect(RUN_NAMES).toContain(n);
  });

  it('assist only reads, points and switches to build; everything else refuses until build', async () => {
    const { call, lab, host } = await setup();
    expect(await call('open_lab', { lab: 'chemistry' })).toEqual(expect.objectContaining({ ok: false, mode: 'assist' }));
    expect(await call('go_to', { where: 'drone' })).toEqual(expect.objectContaining({ ok: false, mode: 'assist' }));
    expect(lab.store.lab).toBeNull();
    lab.open('chemistry');
    expect((await call('look')).ok).toBe(true);
    expect((await call('point_at', { target: 'ph-meter', text: 'this one' })).ok).toBe(true);
    const refused = await call('set_lab_control', { item: 'ph-meter', action: 'power' });
    expect(refused).toEqual(expect.objectContaining({ ok: false, mode: 'assist' }));
    expect(String(refused.error)).toMatch(/one short sentence/);
    expect((await call('start_experiment', { id: 'chemistry/ph' })).ok).toBe(false);
    expect(lab.runner.state.value).toBeNull();
    expect(lookNow(host).companion).toBe('assist');
    expect(await call('set_mode', { mode: 'build' })).toEqual({ ok: true, mode: 'build' });
    expect((await call('start_experiment', { id: 'chemistry/ph' })).ok).toBe(true);
    expect(lookNow(host).companion).toBe('build');
  });

  it('the scripted brain says it is in Assist mode in one line, and switches when asked', async () => {
    const { host } = await setup();
    const tools = createTools(host);
    const conversation = host.conversation;
    const bridge = createBridge({ tools, host, conversation, coach: createCoach(() => 0), fallback: scriptedBrain() });
    const said = () => conversation.turns.filter((t) => t.who === 'agent').at(-1)?.text ?? '';
    await bridge.ask('go to the drone project');
    expect(said()).toMatch(/^I’m in Assist mode, so I can’t do that myself/);
    await bridge.ask('switch to build mode');
    expect(said()).toBe('Build mode on: I can make changes now.');
    await bridge.ask('open the chemistry lab');
    expect(said()).toBe('Chemistry lab is open.');
  });

  it('look carries the open lab brief', async () => {
    const { call, lab } = await setup();
    lab.open('signals');
    const scene = (await call('look')).scene as { scene: string; lab: { experiments: unknown[] } };
    expect(scene.scene).toBe('lab:signals');
    expect(scene.lab.experiments.length).toBeGreaterThan(0);
  });
});
