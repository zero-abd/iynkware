import { describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import { createAssistantService, instantPresence } from '../../src/assistant/service';
import { createProjectStore, createTemplateSource } from '../../src/project/store';
import { createLabContext, type LabContext } from '../../src/lab/context';
import { l6Count, l6Problems } from '../../src/lab/text';
import { createCalloutList, createConversation } from '../../src/agent/bubbles/model';
import { createCoach } from '../../src/agent/coach/coach';
import { createBridge, type Brain } from '../../src/agent/bridge/bridge';
import { intentOf, scriptedBrain } from '../../src/agent/bridge/scripted';
import { AGENT_TEXT } from '../../src/agent/text';
import DECLARATIONS from '../../src/agent/tools/declarations.json';
import { callTool, createTools, KIND_OF, RUN_NAMES, type ToolHost } from '../../src/agent/tools/catalog';

const BLINK = 'prj_uno-r3-blink';

async function setup(opts: { lab?: boolean; doc?: 'blink' | 'empty' } = {}) {
  let t = 0;
  const now = () => t;
  const doc = await loadTemplate(BLINK);
  const project = createProjectStore(doc);
  const assistant = createAssistantService({ project, templates: createTemplateSource(), lang: () => 'en', presence: instantPresence });
  const lab: LabContext = createLabContext(() => 'en');
  const conversation = createConversation();
  const callouts = createCalloutList(now);
  const coach = createCoach(now);
  const host: ToolHost = {
    lang: () => 'en',
    assistant,
    project,
    guide: () => null,
    lab: () => lab,
    callouts,
    conversation,
    observations: (n) => coach.recent(n),
  };
  const tools = createTools(host);
  const call = (name: string, args: unknown = {}) => callTool(tools, name, args);
  const advance = (ms: number) => {
    t += ms;
    coach.tick();
  };
  return { host, tools, call, lab, project, assistant, callouts, conversation, coach, advance };
}

describe('agent tools', () => {
  it('the TS tools and declarations.json stay in sync, in Gemini functionDeclarations shape', () => {
    const names = DECLARATIONS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([...RUN_NAMES].sort());
    expect([...names].sort()).toEqual(Object.keys(KIND_OF).sort());
    const types = new Set(['OBJECT', 'STRING', 'NUMBER', 'INTEGER', 'BOOLEAN', 'ARRAY']);
    const walk = (s: Record<string, unknown>) => {
      expect(types.has(s.type as string)).toBe(true);
      for (const p of Object.values((s.properties ?? {}) as Record<string, Record<string, unknown>>)) walk(p);
      if (s.items) walk(s.items as Record<string, unknown>);
      for (const r of (s.required ?? []) as string[]) expect(Object.keys(s.properties as object)).toContain(r);
    };
    for (const d of DECLARATIONS) {
      expect(d.description.length).toBeGreaterThan(10);
      expect(d.parameters.type).toBe('OBJECT');
      walk(d.parameters as Record<string, unknown>);
    }
  });

  it('refuses unknown tools and bad arguments', async () => {
    const { call } = await setup();
    expect(await call('fly_away')).toMatchObject({ ok: false, error: expect.stringContaining('unknown tool') });
    expect(await call('point_at', { text: 'x' })).toMatchObject({ ok: false, error: 'missing argument "target"' });
    expect(await call('point_at', { target: 'R1', text: 'x', colour: 'red' })).toMatchObject({ ok: false, error: 'unknown argument "colour"' });
    expect(await call('point_at', { target: 'R1', text: 'x', tone: 'loud' })).toMatchObject({ ok: false, error: expect.stringContaining('one of info, do, warn') });
    expect(await call('open_lab', { lab: 'biology' })).toMatchObject({ ok: false });
    expect(await call('accept_step', { all: 'yes' })).toMatchObject({ ok: false, error: 'argument "all" must be true or false' });
    expect(await call('look', [])).toMatchObject({ ok: false });
  });

  it('point_at resolves bench parts, pins and part words, and suggests on unknown', async () => {
    const { call, callouts } = await setup();
    const r1 = await call('point_at', { target: 'resistor', text: 'This one' });
    expect(r1).toMatchObject({ ok: true });
    expect(callouts.list[0]!.target).toMatchObject({ kind: 'bench', target: { kind: 'part' } });
    const parts = (await call('list_targets')).targets as Array<{ id: string; pins: string[] }>;
    const led = parts.find((p) => p.id.startsWith('LED'))!;
    const pin = await call('point_at', { target: `${led.id}.A`, text: 'Long leg' });
    expect(pin).toMatchObject({ ok: true, target: `${led.id}.A` });
    expect(callouts.list.at(-1)!.target).toMatchObject({ kind: 'bench', target: { kind: 'pin', pin: 'A' } });
    const bad = await call('point_at', { target: 'RES9', text: 'x' });
    expect(bad.ok).toBe(false);
    expect(bad.suggestions).toContain('RES1');
    // At most three; the oldest goes.
    await call('point_at', { target: 'board', text: 'b' });
    await call('point_at', { target: 'breadboard', text: 'c' });
    expect(callouts.list).toHaveLength(3);
  });

  it('point_at resolves lab items by id, kind and name; unknown lists close ones', async () => {
    const { call, callouts, lab } = await setup();
    expect(await call('open_lab', { lab: 'chemistry' })).toMatchObject({ ok: true, lab: 'chemistry' });
    const burner = lab.store.byKind('bunsen-burner')!.id;
    expect(await call('point_at', { target: 'burner', text: 'Use this one' })).toMatchObject({ ok: true, target: 'Bunsen burner' });
    expect(callouts.list.at(-1)!.target).toMatchObject({ kind: 'lab', id: burner });
    expect(await call('point_at', { target: burner, text: 'x' })).toMatchObject({ ok: true });
    expect(await call('point_at', { target: 'Bunsenbrenner', text: 'x' })).toMatchObject({ ok: true });
    const bad = await call('point_at', { target: 'bunsen-burnr', text: 'x' });
    expect(bad).toMatchObject({ ok: false });
    expect(bad.suggestions).toContain('bunsen-burner');
  });

  it('lab tools act through the store and refuse in an exam', async () => {
    const { call, lab } = await setup();
    expect(await call('set_lab_control', { item: 'burner', action: 'gas' })).toMatchObject({ ok: false, error: 'no lab is open' });
    await call('open_lab', { lab: 'chemistry' });
    expect(await call('set_lab_control', { item: 'bunsen-burner', action: 'fly' })).toMatchObject({ ok: false, actions: expect.arrayContaining(['gas', 'light']) });
    const light = await call('set_lab_control', { item: 'bunsen-burner', action: 'light' });
    expect(light).toMatchObject({ ok: false, reason: 'no-gas' });
    expect(await call('set_lab_control', { item: 'bunsen-burner', action: 'gas' })).toMatchObject({ ok: true });
    expect(await call('set_lab_control', { item: 'bunsen-burner', action: 'collar', value: 'half' })).toMatchObject({ ok: true });
    expect(lab.store.byKind('bunsen-burner')!.state.p).toMatchObject({ gasOn: true, collar: 'half' });
    expect(lab.store.undo()).toBe(true);
    const stand = await call('request_item', { name: 'fume hood' });
    expect(stand).toMatchObject({ ok: true, found: false, placeholder: true, kind: 'generic' });

    expect(await call('start_experiment', { id: 'chemistry/flame-test', mode: 'practice' })).toMatchObject({ ok: true, step: { source: 'experiment' } });
    const hint = await call('next_step_hint');
    expect(hint).toMatchObject({ ok: true, source: 'experiment', pointed: 'Bunsen burner' });
    expect(typeof hint.hint).toBe('string');

    expect(await call('start_experiment', { id: 'chemistry/flame-test', mode: 'exam' })).toMatchObject({ ok: true, mode: 'exam' });
    expect(await call('set_lab_control', { item: 'bunsen-burner', action: 'gas' })).toMatchObject({ ok: false, error: expect.stringContaining('exam') });
    expect(await call('next_step_hint')).toMatchObject({ ok: false, error: expect.stringContaining('exam') });
    expect(await call('request_item', { name: 'beaker' })).toMatchObject({ ok: false, error: expect.stringContaining('exam') });
    const look = await call('look');
    expect((look.step as { hint: unknown }).hint).toBeNull();
    expect(await call('leave_lab')).toMatchObject({ ok: true });
    expect(lab.store.lab).toBeNull();
  });

  it('propose_build goes through the co-builder: nothing changes until accept_step', async () => {
    const { call, project } = await setup();
    expect(await call('accept_step')).toMatchObject({ ok: false });
    const free = await call('propose_build', { request: 'make a xyzzy plover gadget' });
    expect(free).toMatchObject({ ok: false, error: expect.stringContaining('only templates') });
    const r = await call('propose_build', { request: 'help me build blink' });
    expect(r).toMatchObject({ ok: true, template: BLINK, status: 'proposing', step: { key: 'place:brd_main' } });
    const rev = project.revision;
    expect(await call('accept_step')).toMatchObject({ ok: true, performed: expect.any(String) });
    expect(project.revision).toBeGreaterThan(rev);
    expect(await call('reject_step')).toMatchObject({ ok: true });
    expect(await call('undo_step')).toMatchObject({ ok: true });
  });
});

describe('coach', () => {
  it('coalesces to one observation per 1.5 s and passes hazards through at once', async () => {
    const { coach, advance } = await setup();
    const seen: string[] = [];
    coach.subscribe((o) => seen.push(`${o.kind}:${o.text}`));
    coach.push({ kind: 'project', text: 'a', refs: [] });
    coach.push({ kind: 'sim', text: 'b', refs: [] });
    coach.push({ kind: 'sim', text: 'b', refs: [] });
    coach.push({ kind: 'lab-action', text: 'c', refs: ['lab:x'] });
    expect(seen).toEqual(['project:a']);
    coach.push({ kind: 'hazard', text: 'gas', refs: ['lab:b'] });
    expect(seen).toEqual(['project:a', 'hazard:gas']);
    advance(1000);
    expect(seen).toHaveLength(2);
    advance(600);
    expect(seen).toEqual(['project:a', 'hazard:gas', 'mixed:b; c']);
    expect(coach.recent(5).at(-1)!.refs).toEqual(['lab:x']);
    for (let i = 0; i < 30; i++) coach.push({ kind: 'hazard', text: `h${i}`, refs: [] });
    expect(coach.recent()).toHaveLength(20);
  });

  it('clears old project observations and pending context', async () => {
    const { coach, advance } = await setup();
    coach.push({ kind: 'project', text: 'old bench', refs: [] });
    coach.push({ kind: 'sim', text: 'old pending', refs: [] });
    expect(coach.recent()).toHaveLength(1);
    coach.clear();
    advance(2000);
    expect(coach.recent()).toEqual([]);
  });
});

describe('conversation lifecycle', () => {
  it('starts fresh on a new project but keeps the voice status note', () => {
    const conversation = createConversation();
    conversation.setNote('Voice on');
    conversation.user('old question', { final: true });
    conversation.say('old answer', { final: true, suggestions: ['old chip'] });
    conversation.clear();
    expect(conversation.turns).toEqual([]);
    expect(conversation.suggestions).toEqual([]);
    expect(conversation.note).toBe('Voice on');
  });
});

describe('bridge', () => {
  it('drives a Gemini-like brain: a tool call and streamed say deltas into the bubble', async () => {
    const s = await setup();
    const bridge = createBridge({ tools: s.tools, host: s.host, conversation: s.conversation, coach: s.coach, fallback: scriptedBrain() });
    const fake: Brain = {
      name: 'fake-live',
      async turn({ context }, io) {
        expect(context.system).toEqual(expect.stringContaining('untrusted data'));
        const r = await io.call('point_at', { target: 'RES1', text: 'Use this one' });
        expect(r.ok).toBe(true);
        io.say('This is ');
        io.say('the resistor.');
        io.say('', { final: true });
      },
    };
    const off = bridge.use(fake);
    expect(bridge.brain).toBe('fake-live');
    await bridge.ask('where is the resistor');
    expect(s.conversation.turns.map((t) => [t.who, t.text, t.final])).toEqual([
      ['user', 'where is the resistor', true],
      ['agent', 'This is the resistor.', true],
    ]);
    expect(s.callouts.list).toHaveLength(1);
    expect(bridge.log).toEqual([{ name: 'point_at', ok: true }]);
    off();
    expect(bridge.brain).toBe('scripted');
    // The voice client's calls: state, user and say deltas.
    bridge.state('listening');
    bridge.user('hel');
    bridge.user('lo', { final: true });
    bridge.state('speaking');
    bridge.say('Hi ');
    bridge.say('there', { final: true });
    expect(s.conversation.state).toBe('speaking');
    expect(s.conversation.turns.slice(-2).map((t) => t.text)).toEqual(['hello', 'Hi there']);
    const ctx = JSON.stringify(bridge.context());
    expect(ctx.length).toBeLessThan(16000);
    expect(bridge.functionDeclarations()).toHaveLength(DECLARATIONS.length);
  });

  it('scripted brain: intents in English and German, through the tools', async () => {
    expect(intentOf('What should I do next?')).toEqual({ kind: 'next' });
    expect(intentOf('Was soll ich als Nächstes tun?')).toEqual({ kind: 'next' });
    expect(intentOf('Where is the burner?')).toEqual({ kind: 'where', thing: 'burner' });
    expect(intentOf('Wo ist der Widerstand?')).toEqual({ kind: 'where', thing: 'resistor' });
    expect(intentOf('Open the chemistry lab')).toEqual({ kind: 'open', lab: 'chemistry' });
    expect(intentOf('Öffne das Chemielabor')).toEqual({ kind: 'open', lab: 'chemistry' });
    expect(intentOf('Start the flame test')).toMatchObject({ kind: 'start', id: 'chemistry/flame-test', mode: 'practice' });
    expect(intentOf('Starte die Flammenfärbung als Prüfung')).toMatchObject({ kind: 'start', mode: 'exam' });
    expect(intentOf('Hilf mir, Blink zu bauen')).toMatchObject({ kind: 'build' });
    expect(intentOf('yes')).toEqual({ kind: 'yes' });
    expect(intentOf('nein')).toEqual({ kind: 'no' });
    expect(intentOf('undo that')).toEqual({ kind: 'undo' });
    expect(intentOf('tell me a joke')).toEqual({ kind: 'unknown' });

    const s = await setup();
    const bridge = createBridge({ tools: s.tools, host: s.host, conversation: s.conversation, coach: s.coach, fallback: scriptedBrain() });
    await bridge.ask('Help me build Blink');
    expect(s.assistant.session.value?.state.value.status).toBe('proposing');
    await bridge.ask('yes');
    expect(s.assistant.session.value?.state.value.performed).toHaveLength(1);
    await bridge.ask('Open the chemistry lab');
    expect(s.lab.store.lab).toBe('chemistry');
    await bridge.ask('Where is the burner?');
    expect(s.callouts.list.at(-1)!.target).toMatchObject({ kind: 'lab', itemKind: 'bunsen-burner' });
    await bridge.ask('tell me a joke');
    expect(s.conversation.suggestions.length).toBeGreaterThan(0);
    expect(bridge.log.every((l) => l.ok)).toBe(true);
  });
});

describe('agent strings', () => {
  it('every fixed string in six languages with matching placeholders', () => {
    expect(l6Count(AGENT_TEXT)).toBeGreaterThan(20);
    expect(l6Problems(AGENT_TEXT)).toEqual([]);
  });
});
