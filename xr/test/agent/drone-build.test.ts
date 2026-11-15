/** Building the drone step by step with the companion (xr/src/agent/tools/drone-build.ts), through the real co-build session. */
import { describe, expect, it } from 'vitest';
import { createAssistantService, instantPresence } from '../../src/assistant/service';
import { createCalloutList, createConversation } from '../../src/agent/bubbles/model';
import { intentOf } from '../../src/agent/bridge/scripted';
import { createCoach } from '../../src/agent/coach/coach';
import { planDrone, droneCraftOf } from '../../src/agent/tools/drone-build';
import { callTool, createTools, type ToolHost } from '../../src/agent/tools/catalog';
import { createLabContext } from '../../src/lab/context';
import { benchOf } from '../../src/range/flight/model';
import { createProjectStore, createTemplateSource } from '../../src/project/store';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setup() {
  const templates = createTemplateSource();
  const project = createProjectStore(await templates.load('prj_drone-quad5'));
  const assistant = createAssistantService({ project, templates, lang: () => 'en', presence: instantPresence });
  const coach = createCoach(() => 0);
  const host: ToolHost = {
    lang: () => 'en', assistant, project, guide: () => null, lab: () => createLabContext(() => 'en'),
    callouts: createCalloutList(() => 0), conversation: createConversation(), observations: (n) => coach.recent(n),
  };
  const tools = createTools(host);
  return { project, assistant, call: (name: string, args: unknown = {}) => callTool(tools, name, args) };
}
const placed = (s: { project: { doc: Parameters<typeof benchOf>[0] } }) => Object.values(benchOf(s.project.doc).placed).filter((o) => o === 0).length;

describe('drone build, step by step', () => {
  it('plans one part a step, in build order, without changing the bench', async () => {
    const s = await setup();
    const craft = droneCraftOf(s.project.doc)!;
    const plan = planDrone(s.project.doc)!;
    const fits = plan.steps.filter((x) => x.key.startsWith('drone:') && !x.key.startsWith('drone:test') && x.key !== 'drone:unplug');
    expect(fits.length).toBe(craft.parts.length);
    // the props go on last, after the smoke and motor tests and with the battery out
    const keys = plan.steps.map((x) => x.key);
    expect(keys.slice(-4)).toEqual(['drone:test:smoke', 'drone:test:motors', 'drone:unplug', 'drone:PROPS']);
    expect(plan.steps[0]!.label).toMatch(/^Fit the /);
    expect(placed(s)).toBe(0);
  });

  it('build it with me: yes fits a part, undo takes it off, go_to_step runs to the end', async () => {
    const s = await setup();
    const total = droneCraftOf(s.project.doc)!.parts.length;
    const r = await s.call('propose_build', { request: 'build it with me' });
    expect(r).toMatchObject({ ok: true, drone: true, status: 'proposing' });
    expect(placed(s)).toBe(0);
    await s.call('accept_step');
    expect(placed(s)).toBe(1);
    await s.call('undo_step');
    expect(placed(s)).toBe(0);
    await s.call('go_to_step', { to: 'end' });
    for (let i = 0; i < 200 && s.assistant.session.value?.state.value.status !== 'done'; i++) await sleep(10);
    expect(placed(s)).toBe(total);
    expect((await s.call('propose_build', { request: 'build it with me' })).ok).toBe(false);
  });

  it('typed "build the drone with me" reaches the co-builder', () => {
    expect(intentOf('build the drone with me')).toEqual({ kind: 'build', request: 'build the drone with me' });
    expect(intentOf('build the drone')).toEqual({ kind: 'go', where: 'build the drone' });
  });
});
