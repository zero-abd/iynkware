/**
 * The "Build it with me" service (contracts/assistant.ts `AssistantService`): opens the bench for a build, runs one
 * co-build session at a time with the default co-builder (the scripted one until a model-backed one is `use`d), and
 * hands out the snapshot. Built on narrow parts of the app so it runs headless in tests.
 */
import type { AssistantService, BenchSnapshot, BuildRecipes, CoBuilder, CoBuildSession } from '../contracts/assistant';
import type { Lang } from '../contracts/common';
import type { LessonGuideState } from '../contracts/lesson';
import type { Project, ProjectStore, TemplateSource } from '../contracts/project';
import type { SimBridge } from '../contracts/sim';
import { value } from '../ui/value';
import { createActorChannel } from './actor';
import { say } from './copy';
import { emptyBench } from './empty';
import { scriptedCoBuilder } from './planner';
import { createRecipes } from './recipes';
import { createCoBuildSession, type CoBuildSessionImpl, type StepPresence } from './session';
import { snapshotOf } from './snapshot';

export interface AssistantHost {
  readonly project: ProjectStore;
  readonly templates: TemplateSource;
  readonly sim?: Pick<SimBridge, 'state' | 'lastFrame' | 'findings'>;
  readonly lang: () => Lang;
  readonly guide?: () => LessonGuideState | null;
  /** How steps are seen on the bench; a host with no bench (tests) gets one that shows nothing. */
  readonly presence: StepPresence;
  readonly recipes?: BuildRecipes;
}

/** A presence that shows nothing and commits at once: for tests and for a host with no bench. */
export const instantPresence: StepPresence = {
  preview: () => undefined,
  perform: async (_step, commit) => void commit(),
  rest: () => undefined,
};

export interface AssistantServiceImpl extends AssistantService {
  dispose(): void;
}

/** How each service shows its steps: `app.ts` builds the service headless, the module gives it a body on the bench. */
const presences = new WeakMap<AssistantService, { current: StepPresence; fallback: StepPresence }>();

/**
 * Shows the service's next builds through `presence` (the companion on the bench) instead of the one it was built
 * with; the returned function puts the original back. A build already running keeps the presence it started with.
 */
export function attachPresence(service: AssistantService, presence: StepPresence): () => void {
  const slot = presences.get(service);
  if (!slot) return () => undefined;
  slot.current = presence;
  return () => {
    if (slot.current === presence) slot.current = slot.fallback;
  };
}

export function createAssistantService(host: AssistantHost): AssistantServiceImpl {
  const slot = { current: host.presence, fallback: host.presence };
  const recipes = host.recipes ?? createRecipes();
  const builders: CoBuilder[] = [scriptedCoBuilder()];
  const session = value<CoBuildSession | null>(null);
  let running: CoBuildSessionImpl | null = null;

  const snapshot = (): BenchSnapshot =>
    snapshotOf({
      doc: host.project.doc,
      lang: host.lang(),
      selection: host.project.selection.ids,
      run: host.sim?.state,
      atNs: host.sim?.lastFrame?.atNs ?? null,
      findings: host.sim?.findings,
      guide: host.guide?.() ?? null,
    });

  const service: AssistantServiceImpl = {
    session,
    snapshot,
    use(builder) {
      builders.push(builder);
      return () => {
        const i = builders.lastIndexOf(builder);
        if (i > 0) builders.splice(i, 1);
      };
    },
    async buildWithMe(target, opts = {}) {
      const doc: Project = typeof target === 'string' ? await host.templates.load(target) : target;
      running?.stop();
      if ((opts.from ?? 'empty') === 'empty') host.project.open(emptyBench(doc));
      const builder = opts.builder ?? builders[builders.length - 1]!;
      const channel = createActorChannel(host.project, { actor: builder.actor, kind: 'ai', model: builder.model }, say(host.lang(), 'name'));
      const s = createCoBuildSession({
        store: host.project,
        channel,
        builder,
        goal: { kind: 'build', target: doc },
        recipes,
        snapshot,
        lang: host.lang,
        presence: slot.current,
        auto: opts.auto,
      });
      running = s;
      session.set(s);
      void s.finished.then((last) => {
        if (last.status === 'stopped' && running === s) {
          running = null;
          session.set(null);
        }
      });
      // With `auto` the first plan runs the whole build; the caller gets the session as soon as it is thinking.
      const started = s.start();
      if (!opts.auto) await started;
      return s;
    },
    dispose() {
      running?.stop();
    },
  };
  presences.set(service, slot);
  return service;
}
