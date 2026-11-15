/**
 * Several co-build steps at once (xr/src/agent/tools/steps.ts): `go_to_step` forward, back, to a step or to the end,
 * `stop_steps` mid-run, `accept_step { all }` through the same walk, and the scripted brain's words for them.
 */
import { describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import { createAssistantService, instantPresence } from '../../src/assistant/service';
import type { StepPresence } from '../../src/assistant/session';
import { createCalloutList, createConversation } from '../../src/agent/bubbles/model';
import { intentOf } from '../../src/agent/bridge/scripted';
import { createCoach } from '../../src/agent/coach/coach';
import { callTool, createTools, type ToolHost } from '../../src/agent/tools/catalog';
import { walking } from '../../src/agent/tools/steps';
import { createLabContext } from '../../src/lab/context';
import { createProjectStore, createTemplateSource } from '../../src/project/store';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A companion that takes `ms` to perform each step, like the real carry. */
const slowPresence = (ms: number): StepPresence => ({ ...instantPresence, perform: async (_s, commit) => void (await sleep(ms), commit()) });

async function setup(presence: StepPresence = instantPresence) {
  const project = createProjectStore(await loadTemplate('prj_uno-r3-blink'));
  const assistant = createAssistantService({ project, templates: createTemplateSource(), lang: () => 'en', presence });
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
  const call = (name: string, args: unknown = {}) => callTool(tools, name, args);
  const state = () => assistant.session.value!.state.value;
  /** Waits until no walk is moving the session (status settles and stays settled). */
  const settle = async () => {
    for (let i = 0; i < 400; i++) {
      await sleep(10);
      const st = state();
      if (st.status !== 'performing' && st.status !== 'thinking' && !walking(assistant.session.value!)) return;
    }
  };
  return { call, state, settle, project };
}

describe('go_to_step', () => {
  it('runs the whole build to the end in one call, then back to the start, then to step 3', async () => {
    const s = await setup();
    expect((await s.call('propose_build', { request: 'build blink with me' })).ok).toBe(true);
    const total = await (async () => {
      const r = await s.call('go_to_step', { to: 'end' });
      expect(r).toMatchObject({ ok: true, direction: 'forward', from: 1, to: 'end', running: true });
      await s.settle();
      return s.state().performed.length;
    })();
    expect(s.state().status).toBe('done');
    expect(total).toBeGreaterThan(3);

    expect(await s.call('go_to_step', { to: 'start' })).toMatchObject({ ok: true, direction: 'back' });
    await s.settle();
    expect(s.state()).toMatchObject({ status: 'proposing', performed: [] });

    expect(await s.call('go_to_step', { step: 3 })).toMatchObject({ ok: true, direction: 'forward', to: 3 });
    await s.settle();
    expect(s.state().performed).toHaveLength(2);

    await s.call('go_to_step', { by: -1 });
    await s.settle();
    expect(s.state().performed).toHaveLength(1);
    await s.call('go_to_step', { by: 2 });
    await s.settle();
    expect(s.state().performed).toHaveLength(3);
  });

  it('answers at once while the steps run, and stop_steps stops where it is', async () => {
    const s = await setup(slowPresence(40));
    await s.call('propose_build', { request: 'build blink with me' });
    const r = await s.call('go_to_step', { to: 'end' });
    expect(r.ok).toBe(true);
    expect(s.state().performed.length).toBeLessThan(2);
    await sleep(110);
    const stopped = await s.call('stop_steps');
    expect(stopped.ok).toBe(true);
    await sleep(150);
    const at = s.state().performed.length;
    expect(at).toBeGreaterThan(0);
    await sleep(200);
    expect(s.state().performed.length).toBe(at);
    expect(s.state().status).toBe('proposing');
    expect((await s.call('stop_steps')).ok).toBe(false);
  });

  it('accept_step with all runs the same walk, and a single step command takes over', async () => {
    const s = await setup(slowPresence(30));
    await s.call('propose_build', { request: 'build blink with me' });
    expect(await s.call('accept_step', { all: true })).toMatchObject({ ok: true, performing: 'all remaining steps' });
    await sleep(80);
    await s.call('undo_step');
    await sleep(200);
    const at = s.state().performed.length;
    await sleep(150);
    expect(s.state().performed.length).toBe(at);
  });

  it('refuses without a session or with more than one target', async () => {
    const s = await setup();
    expect((await s.call('go_to_step', { to: 'end' })).ok).toBe(false);
    await s.call('propose_build', { request: 'build blink with me' });
    expect((await s.call('go_to_step', { to: 'end', step: 2 })).ok).toBe(false);
    expect((await s.call('go_to_step', {})).ok).toBe(false);
    expect(await s.call('go_to_step', { to: 'start' })).toMatchObject({ ok: true, moved: 0 });
  });
});

describe('scripted words for steps', () => {
  it('reads all, start, step N, back N, next N and stop', () => {
    for (const t of ['Do all the steps', 'do all of them', 'finish the build', 'do the rest', 'accept all', 'run through it', 'mach alles']) {
      expect(intentOf(t)).toEqual({ kind: 'goto', target: { to: 'end' } });
    }
    for (const t of ['go back to the start', 'start over', 'zurück zum Anfang']) expect(intentOf(t)).toEqual({ kind: 'goto', target: { to: 'start' } });
    expect(intentOf('go to step 3')).toEqual({ kind: 'goto', target: { step: 3 } });
    expect(intentOf('go back to step two')).toEqual({ kind: 'goto', target: { step: 2 } });
    expect(intentOf('go back two steps')).toEqual({ kind: 'goto', target: { by: -2 } });
    expect(intentOf('do the next 3 steps')).toEqual({ kind: 'goto', target: { by: 3 } });
    expect(intentOf('go back')).toEqual({ kind: 'goto', target: { by: -1 } });
    for (const t of ['stop the build', 'pause the steps', 'wait']) expect(intentOf(t)).toEqual({ kind: 'stopSteps' });
    expect(intentOf('stop the circuit')).toEqual({ kind: 'sim', action: 'stop' });
    expect(intentOf('Start the flame test')).toMatchObject({ kind: 'start' });
    expect(intentOf('yes')).toEqual({ kind: 'yes' });
  });
});
