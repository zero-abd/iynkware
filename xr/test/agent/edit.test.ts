/**
 * `propose_edit` (xr/src/agent/tools/edit.ts): the agent's own bench edits as ghosted co-build steps, performed only on
 * accept, done when the person makes them by hand, dry-run in order, and explained when they cannot be done.
 */
import { describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import { stateHash } from '@/project/hash';
import { createAssistantService, instantPresence } from '../../src/assistant/service';
import { createCalloutList, createConversation } from '../../src/agent/bubbles/model';
import { createCoach } from '../../src/agent/coach/coach';
import { compileEdit, createEditBuilder, endOf, planEdits, type EditSpec } from '../../src/agent/tools/edit';
import { callTool, createTools, type ToolHost } from '../../src/agent/tools/catalog';
import { createLabContext } from '../../src/lab/context';
import type { Project } from '../../src/contracts/project';
import { createProjectStore, createTemplateSource } from '../../src/project/store';

const BLINK = 'prj_uno-r3-blink';
const EDITS: EditSpec[] = [
  { action: 'move', part: 'LED1', to: 'c20', reason: 'More room.' },
  { action: 'wire', from: 'U1.5V', to: 'a20', reason: 'Power the LED row.' },
];

async function setup() {
  const project = createProjectStore(await loadTemplate(BLINK));
  const assistant = createAssistantService({ project, templates: createTemplateSource(), lang: () => 'en', presence: instantPresence });
  const coach = createCoach(() => 0);
  const host: ToolHost = {
    lang: () => 'en',
    assistant,
    project,
    guide: () => null,
    lab: () => createLabContext(() => 'en'),
    callouts: createCalloutList(() => 0),
    conversation: createConversation(),
    observations: (n) => coach.recent(n),
  };
  const tools = createTools(host);
  return { project, assistant, call: (name: string, args: unknown = {}) => callTool(tools, name, args) };
}

const view = (d: Project) => d.views.find((v) => v.kind === 'breadboard')!;
const legs = (d: Project, id: string) => view(d).placements.find((p) => p.c === id)?.legs;

describe('edit planning', () => {
  it('names pins the way people say them', async () => {
    const doc = await loadTemplate(BLINK);
    expect(endOf(doc, 'U1.5V')).toEqual({ kind: 'pin', c: 'brd_main', p: 'P5V' });
    expect(endOf(doc, 'u1.3.3V')).toEqual({ kind: 'pin', c: 'brd_main', p: 'P3V3' });
    expect(endOf(doc, 'LED1.a')).toEqual({ kind: 'pin', c: 'cmp_led1', p: 'A' });
    expect(endOf(doc, 'E12')).toEqual({ kind: 'hole', surface: 'cmp_bb', hole: 'e12' });
    expect(endOf(doc, 'U1.D99')).toBeNull();
  });

  it('plans every edit in order on a dry run, reports what it cannot do, and never changes the document', async () => {
    const doc = await loadTemplate(BLINK);
    const before = stateHash(doc);
    const plan = planEdits(doc, [...EDITS, { action: 'place', part: 'core.led-5mm', to: 'h20' }, { action: 'turn', part: 'RES1', deg: 90 }, { action: 'remove', part: 'LED9' }], 'x');
    expect(plan.steps.map((s) => s.kind)).toEqual(['place', 'wire', 'place', 'set']);
    expect(plan.steps[0]).toMatchObject({ part: 'cmp_led1', reason: 'More room.', anchors: [{ kind: 'hole', surface: 'cmp_bb', hole: 'c20' }] });
    expect(plan.unreachable).toHaveLength(1);
    expect(plan.unreachable[0]!.why).toContain('LED9');
    expect(stateHash(doc)).toBe(before);

    const store = createProjectStore(doc);
    for (const s of plan.steps) expect(store.apply(s.ops, { label: s.label }).ok).toBe(true);
    expect(legs(store.doc, 'cmp_led1')?.A).toBe('c20');
    expect(planEdits(store.doc, EDITS, 'x').steps).toHaveLength(0);
  });

  it('drops an edit the person made by hand, and one they declined', async () => {
    const store = createProjectStore(await loadTemplate(BLINK));
    const first = planEdits(store.doc, EDITS, 'x');
    const byHand = compileEdit(store.doc, EDITS[0]!);
    if (!byHand.ok) throw new Error(byHand.why);
    store.apply(byHand.ops, { label: 'person' });
    expect(planEdits(store.doc, EDITS, 'x').steps.map((s) => s.kind)).toEqual(['wire']);
    expect(planEdits(await loadTemplate(BLINK), EDITS, 'x', [first.steps[0]!.key]).steps.map((s) => s.kind)).toEqual(['wire']);
  });

  it('a remove counts as done only for a part that was there when the plan started', async () => {
    const store = createProjectStore(await loadTemplate(BLINK));
    const builder = createEditBuilder([{ action: 'remove', part: 'LED1' }], 'x');
    const ctx = () => ({ doc: store.doc, request: { goal: { kind: 'build' as const, target: store.doc }, declined: [] } }) as never;
    const plan = await builder.propose(ctx());
    expect(plan.steps).toHaveLength(1);
    store.apply(plan.steps[0]!.ops, { label: 'x' });
    expect((await builder.propose(ctx())).steps).toHaveLength(0);
    expect((await builder.propose(ctx())).unreachable).toHaveLength(0);
  });
});

describe('propose_edit', () => {
  it('shows the first edit as a ghost; yes performs it and shows the next; undo takes it back', async () => {
    const s = await setup();
    let r = await s.call('propose_edit', { summary: 'Move the LED and power the row', steps: EDITS });
    expect(r).toMatchObject({ ok: true, status: 'proposing', step: { label: 'Move LED1', reason: 'More room.' } });
    expect(legs(s.project.doc, 'cmp_led1')?.A).toBe('c14');
    r = await s.call('accept_step');
    expect(legs(s.project.doc, 'cmp_led1')?.A).toBe('c20');
    expect(r).toMatchObject({ ok: true, step: { label: 'Wire U1.P5V to a20' } });
    const wires = view(s.project.doc).wires.length;
    await s.call('accept_step');
    expect(view(s.project.doc).wires).toHaveLength(wires + 1);
    expect((await s.call('undo_step')).ok).toBe(true);
    expect(view(s.project.doc).wires).toHaveLength(wires);
  });

  it('guides: when the person makes the move by hand, the next edit is shown', async () => {
    const s = await setup();
    await s.call('propose_edit', { summary: 'x', steps: EDITS });
    const byHand = compileEdit(s.project.doc, EDITS[0]!);
    if (!byHand.ok) throw new Error(byHand.why);
    s.project.apply(byHand.ops, { label: 'person' });
    await new Promise((r) => setTimeout(r, 20));
    expect(s.assistant.session.value?.state.value).toMatchObject({ status: 'proposing', current: { label: 'Wire U1.P5V to a20' } });
  });

  it('explains what it cannot do', async () => {
    const s = await setup();
    const bad = await s.call('propose_edit', { summary: 'x', steps: [{ action: 'wire', from: 'U1.D99', to: 'a1' }] });
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad.unreachable)).toContain('D13');
    expect((await s.call('propose_edit', { summary: 'x', steps: [{ action: 'move', part: 'LED1', to: 'c14' }] })).error).toMatch(/already/);
    expect((await s.call('propose_edit', { summary: 'x', steps: [{ action: 'fly', part: 'LED1' }] })).error).toMatch(/one of/);
  });
});
