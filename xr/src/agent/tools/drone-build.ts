/**
 * "Build it with me" on the drone workbench: a co-builder whose steps fit the drone's parts in build order, one part
 * a step, through the drone bench's own model (`range/flight/model`: `applyBench` with `add`, saved by `benchOps` in
 * the project document, as the bench's own plates do). So the steps run through the same session as a circuit build:
 * the card, yes / skip / undo, accept all, go_to_step and stop_steps all work, and a part the person fits by hand
 * counts as done when the session plans again. Like on the real bench, the battery comes out before a part goes on,
 * and the smoke and motor tests run before the props. Pure over the document: tested headless.
 */
import { applyBatch } from '@/project/apply';
import type { Author } from '@/project/apply';
import { localized } from '../../assistant/copy';
import type { BuildPlan, CoBuilder, PlanStep } from '../../contracts/assistant';
import type { Project } from '../../contracts/project';
import { applyBench, benchCraft, benchOf, benchOps } from '../../range/flight/model';
import type { BenchAction, BenchCraft } from '../../range/flight/model';
import { rangeProjectOf } from '../../range/shared/detect';

const DRY_RUN_AUTHOR = { actor: 'usr_companion', kind: 'ai' } as Author;

/** The open drone's bench rules, or null when the open project is not a drone with a bench. */
export function droneCraftOf(doc: Project): BenchCraft | null {
  const p = rangeProjectOf(doc);
  return p?.kind === 'drone' ? benchCraft(p.contentId) : null;
}

/** The step key of a part: stable across re-plans, so a skipped part stays skipped. */
export const droneStepKey = (part: string): string => `drone:${part}`;

/**
 * The plan for the parts not yet on the right way round, in build order. Each step fits one part (taking it off first
 * if it is on the wrong way), dry-run in order. A skipped part ends the plan: the parts after it are fitted onto it.
 */
export function planDrone(doc: Project, declined: readonly string[] = [], summary = 'Build the drone'): BuildPlan | null {
  const craft = droneCraftOf(doc);
  if (!craft) return null;
  const ctx = { craft, pick: null, cells: 0 };
  const total = craft.parts.length;
  let working = doc;
  const steps: PlanStep[] = [];
  let blocked = false;
  /** One step: these bench actions in order, dry-run; false when it changes nothing or cannot apply. */
  const step = (key: string, label: string, reason: string, actions: readonly BenchAction[]): boolean => {
    if (blocked) return false;
    if (declined.includes(key)) return !(blocked = true);
    let state = benchOf(working);
    for (const action of actions) state = applyBench(state, action, ctx).state;
    const ops = benchOps(working, state);
    if (ops.length === 0) return false;
    const applied = applyBatch(working, ops, { author: DRY_RUN_AUTHOR, at: new Date().toISOString() });
    if (!applied.ok) return !(blocked = true);
    working = applied.state;
    steps.push({ key, kind: 'set', ops, label, reason, anchors: [], needs: [] });
    return true;
  };
  for (let i = 0; i < total && !blocked; i++) {
    const part = craft.parts[i]!;
    if (benchOf(working).placed[part.id] === 0) continue;
    // Nothing is fitted live: the battery comes out first. Props go on last, after the smoke and motor tests pass.
    if (part.id === 'PROPS') {
      const st = benchOf(working);
      if (craft.tests.smoke && !st.smokeOk) step('drone:test:smoke', 'Run the smoke test', 'The smoke stopper catches a short before the battery can do damage.', [{ type: 'smoke' }]);
      if (craft.tests.motors && craft.motors.length && !benchOf(working).motorOk) {
        step('drone:test:motors', 'Run the motor test', 'Each motor must spin, and the right way, before the props go on.', [{ type: 'motors' }]);
      }
    }
    if (benchOf(working).plugged) step('drone:unplug', 'Unplug the battery', 'Never fit parts to a live drone.', [{ type: 'unplug' }]);
    const fit: BenchAction[] = benchOf(working).placed[part.id] === 1 ? [{ type: 'remove', part: part.id }] : [];
    fit.push({ type: 'add', part: part.id, orient: 0 });
    if (!step(droneStepKey(part.id), `Fit the ${part.short}`, `Part ${i + 1} of ${total}, in build order.`, fit)) blocked = true;
  }
  const id = `prp_${Math.random().toString(36).slice(2, 12)}`;
  return { id, baseRevision: doc.revision, summary, steps, unreachable: [] };
}

/** A co-builder that fits the open drone's parts, one a step, re-planned against the bench every time it is asked. */
export function createDroneBuilder(summary = 'Build the drone'): CoBuilder {
  return {
    actor: 'usr_cobuilder',
    model: 'drone-bench@1',
    name: localized('name'),
    propose: async (ctx) => planDrone(ctx.doc, ctx.request.declined, summary) ?? { id: 'prp_none', baseRevision: ctx.doc.revision, summary, steps: [], unreachable: [] },
  };
}
