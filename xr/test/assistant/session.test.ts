import { describe, expect, it } from 'vitest';
import { loadTemplate } from '@content/projects';
import { createSession } from '@/project/session';
import type { AuthoredChannel, CoAuthor, PlanStep } from '../../src/contracts/assistant';
import type { DocChange, Op, Project, ProjectStore } from '../../src/contracts/project';
import { createActorChannel } from '../../src/assistant/actor';
import { netPartition } from '../../src/assistant/planner';
import { createAssistantService, instantPresence } from '../../src/assistant/service';
import type { StepPresence } from '../../src/assistant/session';
import { createProjectStore, createTemplateSource } from '../../src/project/store';

const BLINK = 'prj_uno-r3-blink';
const ORDER = ['place:brd_main', 'place:cmp_bb', 'place:cmp_led1', 'place:cmp_res1', 'wire:wir_1', 'wire:wir_2'];

/** A store without `as(author)`: what the fallback in `actor.ts` is for. The real store offers it since #106. */
const plainStore = (doc: Project): ProjectStore => new Proxy(createProjectStore(doc), { get: (t, k) => (k === 'as' ? undefined : Reflect.get(t, k)) });

async function setup(presence: StepPresence = instantPresence, store?: ProjectStore) {
  const target = await loadTemplate(BLINK);
  const project = store ?? plainStore(target);
  const service = createAssistantService({ project, templates: createTemplateSource(), lang: () => 'en', presence });
  return { target, project, service };
}

const placed = (doc: Project) => doc.views.find((v) => v.kind === 'breadboard')!.placements.map((p) => p.c);
const wires = (doc: Project) => doc.views.find((v) => v.kind === 'breadboard')!.wires.map((w) => w.id);

describe('the co-build session', () => {
  it('proposes one step at a time and performs it only when accepted', async () => {
    const previews: string[] = [];
    const presence: StepPresence = { ...instantPresence, preview: (s) => void previews.push(s.key) };
    const { target, project, service } = await setup(presence);
    const s = await service.buildWithMe(BLINK);
    expect(placed(project.doc)).toEqual([]);
    expect(s.state.value.status).toBe('proposing');
    expect(s.state.value.current?.key).toBe('place:brd_main');
    // Shown, not applied.
    expect(previews).toEqual(['place:brd_main']);
    expect(project.revision).toBe(0);

    await s.accept();
    expect(placed(project.doc)).toEqual(['brd_main']);
    expect(s.state.value.current?.key).toBe('place:cmp_bb');
    for (let i = 0; i < 5; i++) await s.accept();
    expect(s.state.value.status).toBe('done');
    expect(s.state.value.performed.map((p) => p.key)).toEqual(ORDER);
    expect(previews).toEqual(ORDER);
    expect(netPartition(project.doc)).toEqual(netPartition(target));
    expect((await s.finished).status).toBe('done');
  });

  it('accept all builds the rest, each step shown before it is performed', async () => {
    const seen: string[] = [];
    const presence: StepPresence = {
      preview: (s) => void seen.push(`preview ${s.key}`),
      perform: async (s, commit) => {
        seen.push(`perform ${s.key}`);
        commit();
      },
      rest: () => undefined,
    };
    const { target, project, service } = await setup(presence);
    const s = await service.buildWithMe(BLINK);
    await s.accept();
    await s.acceptAll();
    expect(s.state.value.status).toBe('done');
    expect(netPartition(project.doc)).toEqual(netPartition(target));
    expect(seen).toEqual(ORDER.flatMap((k) => [`preview ${k}`, `perform ${k}`]));
  });

  it('a rejected step is never proposed again, nor the steps that need it', async () => {
    const { project, service } = await setup();
    const s = await service.buildWithMe(BLINK);
    await s.reject();
    expect(s.state.value.declined).toEqual(['place:brd_main']);
    expect(s.state.value.current?.key).toBe('place:cmp_bb');
    await s.acceptAll();
    expect(s.state.value.status).toBe('done');
    expect(placed(project.doc)).toEqual(['cmp_bb', 'cmp_led1', 'cmp_res1']);
    expect(wires(project.doc)).toEqual([]);
    expect(s.state.value.plan?.unreachable.map((u) => u.key)).toEqual(['wire:wir_1', 'wire:wir_2']);
  });

  it('undo takes back its last step and proposes it again', async () => {
    const { project, service } = await setup();
    const s = await service.buildWithMe(BLINK);
    for (let i = 0; i < 3; i++) await s.accept();
    expect(placed(project.doc)).toEqual(['brd_main', 'cmp_bb', 'cmp_led1']);
    await s.undo();
    expect(placed(project.doc)).toEqual(['brd_main', 'cmp_bb']);
    expect(s.state.value.current?.key).toBe('place:cmp_led1');
    expect(s.state.value.performed.map((p) => p.key)).toEqual(['place:brd_main', 'place:cmp_bb']);
    await s.undo();
    expect(placed(project.doc)).toEqual(['brd_main']);
    await s.acceptAll();
    expect(s.state.value.status).toBe('done');
    // Undo after done works too, and the build can be finished again.
    await s.undo();
    expect(wires(project.doc)).toEqual(['wir_1']);
    expect(s.state.value.status).toBe('proposing');
    await s.accept();
    expect(wires(project.doc)).toEqual(['wir_1', 'wir_2']);
  });

  it('skips a step the person did with their own hands', async () => {
    const { project, service } = await setup();
    const s = await service.buildWithMe(BLINK);
    await s.accept();
    await s.accept();
    const led = s.state.value.current!;
    expect(led.key).toBe('place:cmp_led1');
    // The person seats the LED themselves (the same ops their hands make).
    expect(project.apply(led.ops as Op[], { label: 'Place LED1' }).ok).toBe(true);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(s.state.value.current?.key).toBe('place:cmp_res1');
    expect(s.state.value.performed.map((p) => p.key)).toEqual(['place:brd_main', 'place:cmp_bb']);
  });

  it("the person's own Undo of a co-builder step brings it back as the proposal", async () => {
    const { project, service } = await setup();
    const s = await service.buildWithMe(BLINK);
    await s.accept();
    await s.accept();
    expect(project.undo()?.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(placed(project.doc)).toEqual(['brd_main']);
    expect(s.state.value.performed.map((p) => p.key)).toEqual(['place:brd_main']);
    expect(s.state.value.current?.key).toBe('place:cmp_bb');
  });

  it('stop during a move applies nothing, and the presence rests', async () => {
    let release!: () => void;
    const moods: string[] = [];
    const presence: StepPresence = {
      preview: () => undefined,
      perform: (_s, commit) =>
        new Promise<void>((r) => {
          release = () => {
            commit();
            r();
          };
        }),
      rest: (m) => void moods.push(m),
    };
    const { project, service } = await setup(presence);
    const s = await service.buildWithMe(BLINK);
    const performing = s.accept();
    expect(s.state.value.status).toBe('performing');
    s.stop();
    release();
    await performing;
    expect(project.revision).toBe(0);
    expect(s.state.value.status).toBe('stopped');
    expect(moods.at(-1)).toBe('idle');
    expect(service.session.value).toBeNull();
  });

  it('every call that does not fit the state does nothing', async () => {
    const { project, service } = await setup();
    const s = await service.buildWithMe(BLINK);
    await s.undo();
    expect(s.state.value.current?.key).toBe('place:brd_main');
    s.stop();
    await s.accept();
    await s.reject();
    await s.undo();
    s.stop();
    expect(project.revision).toBe(0);
    expect(s.state.value.status).toBe('stopped');
  });

  it('builds on what is on the bench when asked to', async () => {
    const { target, project, service } = await setup();
    // A lesson's build mode: board and breadboard already there.
    const store = project;
    const first = await service.buildWithMe(BLINK);
    await first.accept();
    await first.accept();
    first.stop();
    const s = await service.buildWithMe(target, { from: 'bench' });
    expect(s.state.value.current?.key).toBe('place:cmp_led1');
    await s.acceptAll();
    expect(netPartition(store.doc)).toEqual(netPartition(target));
  });
});

/** A store over iynk's session that offers `as(author)`, the shape #106 asks for. */
function storeWithActors(doc: Project): ProjectStore & { as(a: CoAuthor): AuthoredChannel; session: ReturnType<typeof createSession> } {
  const session = createSession({ state: doc, clock: () => 0, rnd: { bytes: (n) => new Uint8Array(n).map((_, i) => i + 1) } });
  const base = createProjectStore(doc);
  const person = { actor: doc.access.owners[0]!, kind: 'user' as const };
  return {
    ...base,
    session,
    get doc() {
      return session.state;
    },
    get revision() {
      return session.revision;
    },
    apply: (ops, o) => session.apply(ops, person, o?.label ? { label: o.label } : undefined),
    undo: () => session.undo(person.actor),
    redo: () => session.redo(person.actor),
    canUndo: () => session.canUndo(person.actor),
    canRedo: () => session.canRedo(person.actor),
    subscribe: (fn: (c: DocChange) => void) => session.subscribe(fn),
    open: (next) => session.replace(next),
    as: (a) => ({
      author: a,
      apply: (ops, o) => session.apply(ops, { actor: a.actor, kind: a.kind, ...(a.model && { model: a.model }), ...(o?.proposal && { proposal: o.proposal }) }, o?.label ? { label: o.label } : undefined),
      undo: () => session.undo(a.actor),
      canUndo: () => session.canUndo(a.actor),
    }),
  };
}

describe('authoring as the co-builder', () => {
  it('with a store that offers actors, ops are attributed to the co-builder and undone on its own stack', async () => {
    const target = await loadTemplate(BLINK);
    const store = storeWithActors(target);
    const service = createAssistantService({ project: store, templates: createTemplateSource(), lang: () => 'en', presence: instantPresence });
    const s = await service.buildWithMe(BLINK);
    await s.accept();
    await s.accept();
    const authors = store.session.state.history.ops.map((e) => e.author);
    expect(authors.length).toBeGreaterThan(0);
    for (const a of authors) {
      expect(a.actor).toBe('usr_cobuilder');
      expect(a.kind).toBe('ai');
      expect(a.model).toBe('scripted@1');
      expect(a.proposal).toMatch(/^prp_[a-z0-9][a-z0-9_-]*$/);
    }
    // The person's Undo has nothing of theirs to undo; the co-builder's undo takes its own step back.
    expect(store.canUndo()).toBe(false);
    await s.undo();
    expect(placed(store.doc)).toEqual(['brd_main']);
  });

  it('without one, the fallback labels its entries and undoes by inverse when it is not on top', async () => {
    const target = await loadTemplate(BLINK);
    const store = plainStore(target);
    const service = createAssistantService({ project: store, templates: createTemplateSource(), lang: () => 'en', presence: instantPresence });
    const s = await service.buildWithMe(BLINK);
    await s.accept();
    await s.accept();
    const channel = createActorChannel(store, { actor: 'usr_cobuilder', kind: 'ai' }, 'Helper');
    expect(channel.emulated).toBe(true);
    channel.dispose();
    // The person moves the breadboard after the co-builder placed it, then asks the co-builder to undo its step.
    const bb = store.doc.views[0]!.placements.find((p) => p.c === 'cmp_bb')!;
    s.stop();
    const s2 = await service.buildWithMe(target, { from: 'bench' });
    await s2.accept();
    expect(placed(store.doc)).toContain('cmp_led1');
    expect(store.apply({ k: 'view.place', view: 'vw_bb', placement: { ...bb, x_mm: bb.x_mm + 10 } }).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    await s2.undo();
    expect(placed(store.doc)).not.toContain('cmp_led1');
    expect(placed(store.doc)).toContain('cmp_bb');
  });
});

describe('the plan steps', () => {
  it('carry what the presence needs: the part to carry and the anchors to point at', async () => {
    const { service } = await setup();
    const s = await service.buildWithMe(BLINK);
    const steps = s.state.value.plan!.steps as PlanStep[];
    const led = steps.find((x) => x.key === 'place:cmp_led1')!;
    expect(led.part).toBe('cmp_led1');
    expect(led.anchors).toEqual([
      { kind: 'hole', surface: 'cmp_bb', hole: 'c14' },
      { kind: 'hole', surface: 'cmp_bb', hole: 'c15' },
    ]);
    const wire = steps.find((x) => x.key === 'wire:wir_1')!;
    expect(wire.anchors).toEqual([
      { kind: 'pin', part: 'brd_main', pin: 'D13' },
      { kind: 'hole', surface: 'cmp_bb', hole: 'a10' },
    ]);
    expect(wire.needs).toEqual(['place:brd_main', 'place:cmp_bb']);
  });
});
