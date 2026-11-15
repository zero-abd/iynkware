/**
 * The agent's hands on the bench (src/agent/tools/bench.ts): it changes the circuit, takes changes back, explains what
 * is wrong with the simulator's real circuit check, and applies the fix. Then the same through the scripted brain, as
 * a person types it with no voice model.
 */
import { describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import { createAssistantService, instantPresence } from '../../src/assistant/service';
import { createProjectStore, createTemplateSource } from '../../src/project/store';
import { createLabContext } from '../../src/lab/context';
import { createCalloutList, createConversation } from '../../src/agent/bubbles/model';
import { createCoach } from '../../src/agent/coach/coach';
import { createBridge } from '../../src/agent/bridge/bridge';
import { intentOf, scriptedBrain } from '../../src/agent/bridge/scripted';
import { callTool, createTools, type ToolHost } from '../../src/agent/tools/catalog';
import { createSimBridge, inlinePort } from '../../src/sim/bridge';

async function setup() {
  const project = createProjectStore(await loadTemplate('prj_uno-r3-blink'));
  const sim = createSimBridge({ port: inlinePort({ wallMs: () => 0, schedule: () => undefined }) });
  const assistant = createAssistantService({ project, templates: createTemplateSource(), lang: () => 'en', presence: instantPresence });
  const lab = createLabContext(() => 'en');
  const conversation = createConversation();
  const callouts = createCalloutList(() => 0);
  const coach = createCoach(() => 0);
  const host: ToolHost = {
    lang: () => 'en',
    assistant,
    project,
    guide: () => null,
    lab: () => lab,
    callouts,
    conversation,
    observations: (n) => coach.recent(n),
    bench: { project, sim },
  };
  const tools = createTools(host);
  const call = (name: string, args: unknown = {}) => callTool(tools, name, args);
  const bridge = createBridge({ tools, host, conversation, coach, fallback: scriptedBrain() });
  const lastSaid = () => conversation.turns.filter((t) => t.who === 'agent').at(-1)?.text ?? '';
  const parts = () => project.doc.components.map((c) => c.refdes).sort();
  return { project, sim, lab, callouts, call, bridge, lastSaid, parts };
}

/** Blink with its resistor swapped for a plain jumper: the LED has nothing to limit its current. */
async function noResistor(s: Awaited<ReturnType<typeof setup>>) {
  expect((await s.call('edit_bench', { action: 'removePart', args_json: '{"part":"RES1"}' })).ok).toBe(true);
  const wire = { from: { kind: 'hole', surface: 'cmp_bb', hole: 'e10' }, to: { kind: 'hole', surface: 'cmp_bb', hole: 'e14' } };
  expect((await s.call('edit_bench', { action: 'addWire', args_json: JSON.stringify(wire) })).ok).toBe(true);
}

describe('the agent changes the bench', () => {
  it('removes a part named by refdes, and undo and redo take it back and put it back', async () => {
    const s = await setup();
    expect(s.parts()).toEqual(['BB1', 'LED1', 'RES1']);
    const r = await s.call('edit_bench', { action: 'removePart', args_json: '{"part":"RES1"}' });
    expect(r).toEqual(expect.objectContaining({ ok: true }));
    expect(s.parts()).toEqual(['BB1', 'LED1']);
    expect((await s.call('undo')).ok).toBe(true);
    expect(s.parts()).toEqual(['BB1', 'LED1', 'RES1']);
    expect((await s.call('redo')).ok).toBe(true);
    expect(s.parts()).toEqual(['BB1', 'LED1']);
    expect((await s.call('redo')).ok).toBe(false);
  });

  it('turns and pulls a part, each one undo', async () => {
    const s = await setup();
    const legs = () => s.project.doc.views.find((v) => v.kind === 'breadboard')!.placements!.find((p) => p.c === 'cmp_led1')!.legs;
    const before = legs();
    expect((await s.call('edit_bench', { action: 'turnPart', args_json: '{"part":"LED1","step":-1}' })).ok).toBe(true);
    expect(legs()).not.toEqual(before);
    expect((await s.call('edit_bench', { action: 'pullPart', args_json: '{"part":"LED1"}' })).ok).toBe(true);
    expect(legs() ?? {}).toEqual({});
    expect((await s.call('undo', { times: 2 })).ok).toBe(true);
    expect(legs()).toEqual(before);
  });

  it('refuses a bad change and says why, and changes nothing', async () => {
    const s = await setup();
    const rev = s.project.revision;
    const r = await s.call('edit_bench', { action: 'removePart', args_json: '{"part":"NOPE9"}' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toMatch(/refused/);
    expect((await s.call('edit_bench', { action: 'removePart', args_json: 'not json' })).ok).toBe(false);
    expect(s.project.revision).toBe(rev);
  });

  it('does not touch the circuit while a lab is open', async () => {
    const s = await setup();
    s.lab.open('chemistry');
    expect((await s.call('edit_bench', { action: 'removePart', args_json: '{"part":"RES1"}' })).ok).toBe(false);
    expect(s.parts()).toEqual(['BB1', 'LED1', 'RES1']);
  });
});

describe('the agent explains what is wrong and fixes it', () => {
  it('finds nothing wrong in Blink', async () => {
    const s = await setup();
    const r = await s.call('explain_problems');
    expect(r).toEqual(expect.objectContaining({ ok: true, count: 0 }));
  });

  it('explains an LED with no resistor in words, points at it, and fixes it in one undoable change', async () => {
    const s = await setup();
    await noResistor(s);
    const r = await s.call('explain_problems');
    expect(r.ok).toBe(true);
    const p = (r.problems as Array<{ title: string; why: string; fix: string; about: string[]; fixes: Array<{ text: string; canApply: boolean; safe: boolean }> }>)[0]!;
    expect(p.title).toBe('LED with no series resistor');
    expect(p.why).toMatch(/limits the current/);
    expect(p.about).toContain('LED1');
    expect(p.fixes[0]).toEqual(expect.objectContaining({ canApply: true, safe: true }));
    expect(p.fixes[0]!.text).toMatch(/resistor in series with LED1/);
    expect(s.callouts.list.map((c) => c.target.name)).toContain('LED1');

    const fixed = await s.call('apply_fix', { problem: 1 });
    expect(fixed.ok).toBe(true);
    expect((await s.call('explain_problems', { point: false })).count).toBe(0);
    await s.call('undo');
    expect((await s.call('explain_problems', { point: false })).count).toBe(1);
  });

  it('applies every safe fix at once', async () => {
    const s = await setup();
    await noResistor(s);
    expect((await s.call('apply_fix', { all_safe: true })).ok).toBe(true);
    expect((await s.call('explain_problems', { point: false })).count).toBe(0);
  });

  it('says there is nothing to fix on a good circuit', async () => {
    const s = await setup();
    expect((await s.call('apply_fix', {})).ok).toBe(false);
  });

  it('in a lab, explains the tutor’s mistakes and undoes the last lab change', async () => {
    const s = await setup();
    s.lab.open('chemistry');
    const burner = s.lab.store.byKind('bunsen-burner')!.id;
    s.lab.store.apply(burner, { type: 'gas' });
    expect(s.lab.store.get(burner)!.state.p.gasOn).toBe(true);
    const r = await s.call('explain_problems');
    expect(r).toEqual(expect.objectContaining({ ok: true, mode: 'lab' }));
    expect((await s.call('undo')).ok).toBe(true);
    expect(s.lab.store.get(burner)!.state.p.gasOn).toBe(false);
  });
});

describe('typed to the scripted brain (no voice model)', () => {
  it('understands the new requests', () => {
    expect(intentOf("What's wrong?").kind).toBe('wrong');
    expect(intentOf('why does it not work').kind).toBe('wrong');
    expect(intentOf('Was ist falsch?').kind).toBe('wrong');
    expect(intentOf('fix it').kind).toBe('fix');
    expect(intentOf('redo').kind).toBe('redo');
    expect(intentOf('undo').kind).toBe('undo');
    expect(intentOf('remove the resistor')).toEqual({ kind: 'edit', action: 'removePart', thing: 'resistor' });
    expect(intentOf('pull out the LED')).toEqual({ kind: 'edit', action: 'pullPart', thing: 'led' });
    expect(intentOf('turn the led around')).toEqual(expect.objectContaining({ kind: 'edit', action: 'turnPart', half: true }));
    expect(intentOf('run the circuit')).toEqual({ kind: 'sim', action: 'run' });
  });

  it('turns the LED around in one change, and undo turns it back', async () => {
    const s = await setup();
    const legs = () => s.project.doc.views.find((v) => v.kind === 'breadboard')!.placements!.find((p) => p.c === 'cmp_led1')!.legs;
    const before = legs();
    await s.bridge.ask('turn the LED around');
    expect(s.lastSaid()).toMatch(/^Done: Rotate LED1/);
    expect(legs()).not.toEqual(before);
    await s.bridge.ask('undo');
    expect(legs()).toEqual(before);
  });

  it('says why when a change cannot be made', async () => {
    const s = await setup();
    await s.bridge.ask('remove the flux capacitor');
    expect(s.lastSaid()).toMatch(/^I could not do that/);
  });

  it('removes the resistor, undoes it, explains a fault and fixes it', async () => {
    const s = await setup();
    await s.bridge.ask('remove the resistor');
    expect(s.parts()).toEqual(['BB1', 'LED1']);
    expect(s.lastSaid()).toMatch(/^Done: /);
    await s.bridge.ask('undo');
    expect(s.parts()).toEqual(['BB1', 'LED1', 'RES1']);
    expect(s.lastSaid()).toBe('Taken back.');

    await noResistor(s);
    await s.bridge.ask("what's wrong?");
    expect(s.lastSaid()).toMatch(/LED with no series resistor\. Nothing limits the current/);
    expect(s.lastSaid()).toMatch(/fix it/);
    await s.bridge.ask('fix it');
    expect(s.lastSaid()).toMatch(/^Fixed: Add a 330 Ω resistor in series with LED1\./);
    await s.bridge.ask("what's wrong?");
    expect(s.lastSaid()).toBe('I checked the circuit: nothing is wrong.');
  });
});
