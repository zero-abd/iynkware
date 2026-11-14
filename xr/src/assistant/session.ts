/**
 * One "Build it with me" run (contracts/assistant.ts `CoBuildSession`): propose, ghost, accept, perform. The co-builder
 * plans from a snapshot; the current step is shown by the presence as a ghost at its anchors; only an accepted step is
 * applied, through the co-builder's authored channel, when the companion arrives with it. A plan is kept while the
 * document is exactly what it expects (only the session's own steps changed it); any other change (the person's
 * hands, their Undo, a load) means a fresh plan from a fresh snapshot, so a step the person did themselves is skipped
 * and nothing is applied against a bench the plan did not see.
 *
 * No three.js here: the presence is an interface, so this is tested headless.
 */
import type {
  BenchSnapshot,
  BuildGoal,
  BuildPlan,
  BuildRecipes,
  CoBuilder,
  CoBuildSession,
  CoBuildState,
  PlanStep,
} from '../contracts/assistant';
import type { Lang, Unsubscribe } from '../contracts/common';
import type { ApplyResult, Project, ProjectStore } from '../contracts/project';
import { value } from '../ui/value';
import type { ActorChannel } from './actor';
import { say } from './copy';

/** How a step is seen and done on the bench. The session decides what happens; the presence shows it. */
export interface StepPresence {
  /** Shows `step` as a ghost at its anchors, the companion pointing at it. Replaces any earlier preview. */
  preview(step: PlanStep, doc: Project): void;
  /**
   * Carries the part or draws the wire, and calls `commit` once, when it arrives: the ops land then and `commit` says
   * whether they did. Resolves when the move is over. A presence that never calls `commit` gets it called after.
   */
  perform(step: PlanStep, commit: () => boolean): Promise<void>;
  /** No step on the bench: thinking, done or stopped. Clears the preview. */
  rest(mood: 'thinking' | 'idle' | 'done'): void;
}

export interface SessionDeps {
  readonly store: ProjectStore;
  readonly channel: ActorChannel;
  readonly builder: CoBuilder;
  readonly goal: BuildGoal;
  readonly recipes: BuildRecipes;
  readonly snapshot: () => BenchSnapshot;
  readonly lang: () => Lang;
  readonly presence: StepPresence;
  /** Start in accept-all. */
  readonly auto?: boolean;
}

export interface CoBuildSessionImpl extends CoBuildSession {
  /** Asks for the first plan. Resolves when the first step is proposed (or, with `auto`, when the run ends). */
  start(): Promise<void>;
}

export function createCoBuildSession(deps: SessionDeps): CoBuildSessionImpl {
  const { store, channel, builder, presence } = deps;
  const state = value<CoBuildState>({
    status: 'thinking',
    actor: builder.actor,
    plan: null,
    current: null,
    performed: [],
    declined: [],
    auto: deps.auto ?? false,
  });
  const patch = (p: Partial<CoBuildState>) => state.set({ ...state.value, ...p });
  let resolveFinished!: (s: CoBuildState) => void;
  const finished = new Promise<CoBuildState>((r) => (resolveFinished = r));

  /** The revision the current plan expects; any other revision means someone else changed the bench. */
  let expected = store.revision;
  /** Bumped by every new plan and by stop, so a slow proposal for an older bench is dropped. */
  let generation = 0;
  let applying = false;
  let ended = false;
  const failedOnce = new Set<string>();
  const offs: Unsubscribe[] = [];

  const end = (status: 'done' | 'stopped' | 'failed', message: string) => {
    patch({ status, current: null, auto: false, message });
    presence.rest(status === 'done' ? 'done' : 'idle');
    resolveFinished(state.value);
  };

  async function plan(): Promise<void> {
    if (ended) return;
    const gen = ++generation;
    patch({ status: 'thinking', current: null, message: undefined });
    presence.rest('thinking');
    const revision = store.revision;
    let next: BuildPlan;
    try {
      next = await builder.propose({
        snapshot: deps.snapshot(),
        request: { goal: deps.goal, declined: state.value.declined },
        doc: store.doc,
        recipes: deps.recipes,
      });
    } catch (err) {
      if (gen === generation && !ended) end('failed', say(deps.lang(), 'failed', { why: (err as Error).message }));
      return;
    }
    if (gen !== generation || ended) return;
    // The bench moved on while the co-builder was thinking: think again about the bench as it is.
    if (store.revision !== revision) return plan();
    expected = revision;
    return propose(next, 0);
  }

  async function propose(p: BuildPlan, index: number): Promise<void> {
    const step = p.steps[index];
    if (!step) {
      end('done', say(deps.lang(), state.value.performed.length > 0 ? 'done' : 'nothingLeft'));
      return;
    }
    patch({ status: 'proposing', plan: p, current: step });
    presence.preview(step, store.doc);
    if (state.value.auto) await accept();
  }

  async function accept(): Promise<void> {
    const { status, current: step, plan: p } = state.value;
    if (status !== 'proposing' || !step || !p) return;
    patch({ status: 'performing' });
    let result: ApplyResult | null = null;
    const commit = () => {
      if (result || ended) return result?.ok ?? false;
      applying = true;
      try {
        result = channel.apply(step.ops, { label: step.label, proposal: p.id });
      } finally {
        applying = false;
      }
      return result.ok;
    };
    await presence.perform(step, commit);
    if (ended) return;
    commit();
    const res = result as ApplyResult | null;
    if (!res?.ok) {
      // Refused: the bench changed under the move. Plan again from what is there, once per step.
      if (failedOnce.has(step.key)) return end('failed', say(deps.lang(), 'failed', { why: res?.message ?? step.label }));
      failedOnce.add(step.key);
      return plan();
    }
    expected = res.revision;
    patch({ performed: [...state.value.performed, { key: step.key, label: step.label, revision: res.revision }] });
    if (store.revision !== expected) return plan();
    return propose(p, p.steps.indexOf(step) + 1);
  }

  // The step `undo` would take back is gone already (the person's Undo, in the store fallback): forget it. The store
  // change that did it reaches the subscription below, which plans again.
  offs.push(
    channel.onTaken(() => {
      patch({ performed: state.value.performed.slice(0, -1) });
    }),
  );

  offs.push(
    store.subscribe(() => {
      if (applying || ended || store.revision === expected) return;
      // Someone else changed the bench. While a step waits for the person, show a step for the bench as it is now.
      if (state.value.status === 'proposing') void plan();
    }),
  );

  return {
    state,
    finished,
    start: () => plan(),
    accept,
    async acceptAll() {
      if (state.value.status !== 'proposing') return;
      patch({ auto: true });
      await accept();
    },
    async reject() {
      const { status, current } = state.value;
      if (status === 'performing') return patch({ auto: false });
      if (status !== 'proposing' || !current) return;
      patch({ declined: [...state.value.declined, current.key], auto: false });
      await plan();
    },
    async undo() {
      const { status, performed } = state.value;
      if (status === 'performing') return patch({ auto: false });
      if ((status !== 'proposing' && status !== 'done') || performed.length === 0 || ended) return;
      applying = true;
      let res: ApplyResult | null;
      try {
        res = channel.undo();
      } finally {
        applying = false;
      }
      if (!res?.ok) {
        patch({ message: say(deps.lang(), 'failed', { why: res?.message ?? '' }) });
        return;
      }
      expected = store.revision;
      patch({ performed: performed.slice(0, -1), auto: false });
      await plan();
    },
    stop() {
      if (ended) return;
      generation++;
      end('stopped', say(deps.lang(), 'stopped'));
      ended = true;
      for (const off of offs.splice(0)) off();
      channel.dispose();
    },
  };
}
