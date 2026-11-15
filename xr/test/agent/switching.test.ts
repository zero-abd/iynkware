/**
 * Switching benches (#371): what the companion keeps and drops when the person moves between the circuit bench, a lab,
 * the drone workbench and the Range, and where voice requests for every kind of bench go.
 */
import { describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import { createAssistantService, instantPresence } from '../../src/assistant/service';
import { agentOf } from '../../src/agent/hub';
import { coachModule } from '../../src/agent/coach';
import { destinationOf } from '../../src/agent/tools/navigate';
import { intentOf } from '../../src/agent/bridge/scripted';
import { createLabContext, setLabOf } from '../../src/lab/context';
import { createProjectStore, createTemplateSource } from '../../src/project/store';
import { value } from '../../src/ui/value';
import type { XrApp } from '../../src/contracts/app';

const projects = () => [{ id: 'p1', title: 'My Robot Car' }];
const at = (w: string) => destinationOf(w, { projects });

async function coachApp() {
  const world = { registerSystem: () => undefined };
  const project = createProjectStore(await loadTemplate('prj_uno-r3-blink'));
  const lab = createLabContext(() => 'en');
  setLabOf(world, lab);
  const place = value<'bench' | 'range' | 'room'>('bench');
  const app = {
    world,
    project,
    settings: { lang: value('en') },
    shell: { place, offered: value<string[]>(['bench']) },
    sim: { onState: () => () => undefined, onFindings: () => () => undefined },
    guide: value(null),
  } as unknown as XrApp;
  const off = coachModule.mount(app) as () => void;
  const hub = agentOf(world);
  const said = () => hub.coach.recent().map((o) => o.text);
  const flush = () => {
    for (let i = 0; i < 3; i++) hub.coach.tick();
  };
  const talk = () => {
    hub.conversation.user('old question', { final: true });
    hub.conversation.say('old answer about the bench', { final: true });
    hub.callouts.add({ kind: 'lab', id: 'x', itemKind: 'beaker', name: 'beaker' }, 'use this one');
  };
  return { app, hub, lab, place, project, said, flush, talk, off };
}

describe('switching benches clears what belonged to the last one', () => {
  it('a drone project opening: no old turns, pointers or observations; the companion is told it is the drone workbench', async () => {
    const s = await coachApp();
    s.talk();
    s.project.open(await createTemplateSource().load('prj_drone-quad5'));
    s.flush();
    expect(s.hub.conversation.turns).toEqual([]);
    expect(s.hub.callouts.list).toEqual([]);
    expect(s.said().some((t) => /now at the drone workbench/.test(t))).toBe(true);
    expect(s.said().some((t) => /old/.test(t))).toBe(false);
    s.off();
  });

  it('a lab opening or closing starts fresh too, and says which lab or bench', async () => {
    const s = await coachApp();
    s.talk();
    s.lab.open('chemistry');
    s.flush();
    expect(s.hub.conversation.turns).toEqual([]);
    expect(s.said().some((t) => /now at the chemistry lab/.test(t))).toBe(true);
    s.talk();
    s.lab.leave();
    s.flush();
    expect(s.hub.conversation.turns).toEqual([]);
    expect(s.said().some((t) => /now at the circuit workbench/.test(t))).toBe(true);
    s.off();
  });

  it('the same drone at another place keeps the talk but drops pointers, and says where', async () => {
    const s = await coachApp();
    s.talk();
    s.place.set('range');
    s.flush();
    expect(s.hub.conversation.turns.length).toBeGreaterThan(0);
    expect(s.hub.callouts.list).toEqual([]);
    expect(s.said().some((t) => /flying in the Range/.test(t))).toBe(true);
    s.off();
  });
});

describe('a running build does not follow the person to another bench', () => {
  it('ends when another project opens', async () => {
    const project = createProjectStore(await loadTemplate('prj_uno-r3-blink'));
    const templates = createTemplateSource();
    const assistant = createAssistantService({ project, templates, lang: () => 'en', presence: instantPresence });
    const s = await assistant.buildWithMe('prj_uno-r3-blink');
    expect(s.state.value.status).toBe('proposing');
    project.open(await templates.load('prj_drone-quad5'));
    await new Promise((r) => setTimeout(r, 20));
    expect(s.state.value.status).toBe('stopped');
    expect(assistant.session.value).toBeNull();
  });
});

describe('voice requests for every bench', () => {
  it('names each bench', () => {
    expect(at('chemistry lab')).toEqual({ kind: 'lab', lab: 'chemistry' });
    expect(at('the physics lab')).toEqual({ kind: 'lab', lab: 'physics' });
    expect(at('electrical lab')).toEqual({ kind: 'lab', lab: 'electrical' });
    expect(at('signals and systems lab')).toEqual({ kind: 'lab', lab: 'signals' });
    expect(at('drone workbench')).toEqual({ kind: 'droneBench' });
    expect(at('fly the drone')).toEqual({ kind: 'drone' });
    expect(at('circuit workbench')).toEqual({ kind: 'bench' });
    expect(at('workbench')).toEqual({ kind: 'bench' });
    expect(at('new project')).toEqual({ kind: 'new' });
    expect(at('my robot car')).toEqual({ kind: 'project', id: 'p1', title: 'My Robot Car' });
    expect(at('home')).toEqual({ kind: 'home' });
  });

  it('typed or offline, the same words become go_to', () => {
    for (const w of ['switch to the drone workbench', 'take me to the circuit workbench', 'go back to the drone bench', 'switch to the electronics bench']) {
      expect(intentOf(w)).toEqual(expect.objectContaining({ kind: 'go' }));
    }
    expect(intentOf('go to the physics lab')).toEqual({ kind: 'open', lab: 'physics' });
    expect(intentOf('work on the tiny whoop')).toEqual({ kind: 'go', where: 'work on the tiny whoop' });
    expect(at('work on the tiny whoop')).toEqual(expect.objectContaining({ kind: 'craft', at: 'bench' }));
    expect(at('electronics bench')).toEqual({ kind: 'bench' });
    expect(at('arduino workbench')).toEqual({ kind: 'bench' });
  });
});
