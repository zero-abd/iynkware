/**
 * The person's own build, no template: go_to "new project" for an empty workbench, find_parts in the library, add_part
 * onto the bench (loose, or into a hole), typed and through the tools.
 */
import { describe, expect, it } from 'vitest';
import { blankProject } from '@/project/blank';
import { createAssistantService, instantPresence } from '../../src/assistant/service';
import { createProjectStore, createTemplateSource } from '../../src/project/store';
import { createLabContext } from '../../src/lab/context';
import { createCalloutList, createConversation } from '../../src/agent/bubbles/model';
import { createCoach } from '../../src/agent/coach/coach';
import { createBridge } from '../../src/agent/bridge/bridge';
import { intentOf, scriptedBrain } from '../../src/agent/bridge/scripted';
import { callTool, createTools, type ToolHost } from '../../src/agent/tools/catalog';
import { destinationOf, type Destination } from '../../src/agent/tools/navigate';

async function setup() {
  // what New project makes: an Uno and nothing else, not even a breadboard
  const project = createProjectStore(blankProject({ board: 'uno', id: 'prj_mine', title: 'Mine', locale: 'en', now: '2026-11-15T00:00:00Z', actor: 'act_me' }));
  const assistant = createAssistantService({ project, templates: createTemplateSource(), lang: () => 'en', presence: instantPresence });
  const lab = createLabContext(() => 'en');
  const conversation = createConversation();
  const callouts = createCalloutList(() => 0);
  const coach = createCoach(() => 0);
  const went: Destination[] = [];
  const host: ToolHost = {
    lang: () => 'en',
    assistant,
    project,
    guide: () => null,
    lab: () => lab,
    callouts,
    conversation,
    observations: (n) => coach.recent(n),
    bench: { project },
    nav: {
      projects: () => [],
      go: async (d) => (went.push(d), true),
      controls: () => [],
      runControl: () => false,
      where: () => ({ place: 'bench', lab: null, project: project.doc.id }),
    },
  };
  const tools = createTools(host);
  const call = (name: string, args: unknown = {}) => callTool(tools, name, args);
  const bridge = createBridge({ tools, host, conversation, coach, fallback: scriptedBrain() });
  const lastSaid = () => conversation.turns.filter((t) => t.who === 'agent').at(-1)?.text ?? '';
  const refs = () => project.doc.components.map((c) => c.definition.ref);
  return { project, call, bridge, lastSaid, refs, went };
}

describe('an empty workbench', () => {
  it('"new project", "empty bench" and "from scratch" are a new empty workbench', () => {
    const at = (w: string) => destinationOf(w, { projects: () => [] });
    for (const w of ['new project', 'an empty workbench', 'empty bench', 'blank project', 'start from scratch', 'new', 'my own project']) {
      expect(at(w), w).toEqual({ kind: 'new' });
    }
    expect(at('workbench')).toEqual({ kind: 'bench' });
  });

  it('typed, it opens one', async () => {
    expect(intentOf('make the workbench empty').kind).toBe('empty');
    expect(intentOf('I want to start with an empty bench').kind).toBe('empty');
    expect(intentOf('build my own thing').kind).toBe('empty');
    const s = await setup();
    await s.bridge.ask('start a new project');
    expect(s.went).toEqual([{ kind: 'new' }]);
    expect(s.lastSaid()).toMatch(/^Here is an empty workbench/);
  });

  it('a free build request points to the empty workbench, not only templates', async () => {
    const s = await setup();
    await s.bridge.ask('build a weather station');
    expect(s.lastSaid()).toMatch(/new project/);
  });
});

describe('parts from the library', () => {
  it('finds a part by everyday words, and says when there is none', async () => {
    const s = await setup();
    const led = await s.call('find_parts', { query: 'LED' });
    expect(led).toEqual(expect.objectContaining({ ok: true, inLibrary: true }));
    expect((led.parts as Array<{ ref: string }>).some((p) => /led/.test(p.ref))).toBe(true);
    expect(await s.call('find_parts', { query: 'flux capacitor' })).toEqual(expect.objectContaining({ ok: true, inLibrary: false }));
    const all = await s.call('find_parts', {});
    expect(all.total as number).toBeGreaterThan(10);
  });

  it('adds a part loose, then one into a hole, each one undo', async () => {
    const s = await setup();
    const before = s.refs().length;
    expect(await s.call('add_part', { name: 'led', hole: 'e12' })).toEqual(expect.objectContaining({ ok: false, needs: 'breadboard' }));
    expect(await s.call('add_part', { name: 'breadboard' })).toEqual(expect.objectContaining({ ok: true }));
    const r = await s.call('add_part', { name: '220 ohm resistor' });
    expect(r).toEqual(expect.objectContaining({ ok: true }));
    expect(String(r.ref)).toMatch(/resistor/);
    expect(s.refs().length).toBe(before + 2);
    const seated = await s.call('add_part', { name: 'core.led-5mm', hole: 'e12' });
    expect(seated).toEqual(expect.objectContaining({ ok: true, ref: 'core.led-5mm' }));
    expect(s.refs().length).toBe(before + 3);
    for (let i = 0; i < 3; i++) expect((await s.call('undo')).ok).toBe(true);
    expect(s.refs().length).toBe(before);
    expect(s.project.doc.views.find((v) => v.kind === 'breadboard')!.surface).toBeUndefined();
    expect(await s.call('add_part', { name: 'flux capacitor' })).toEqual(expect.objectContaining({ ok: false, inLibrary: false }));
  });

  it('typed: is there a part, and add it', async () => {
    expect(intentOf('is there a servo in the library')).toEqual({ kind: 'find', name: 'servo' });
    expect(intentOf('add an LED to the bench')).toEqual({ kind: 'add', name: 'led' });
    const s = await setup();
    await s.bridge.ask('do you have a push button');
    expect(s.lastSaid()).toMatch(/^Yes, the library has/);
    await s.bridge.ask('add a push button');
    expect(s.lastSaid()).toMatch(/^Added .+ to the bench/);
    await s.bridge.ask('add a flux capacitor');
    expect(s.lastSaid()).toMatch(/has no “flux capacitor”/);
  });
});
