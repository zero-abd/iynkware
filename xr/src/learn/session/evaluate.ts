/**
 * The lesson's steps and completion with iynk's guided engine (`src/project/guided/engine.ts`), ported from the
 * Studio's guide hook (`src/components/studio/guide/useGuide.ts`, `GuideMount.tsx`) without React: the same plan
 * reading, the same `GuideDeps`, the same history view. Pure apart from the deps reading the document passed in.
 */
import { canonicalize } from '@/core/canonical';
import { sha256Hex } from '@/core/sha256';
import { stateMatches } from '@/lib/interp/state-match';
import { evaluateCompletion, evaluateSteps, type CompletionResult, type GuideDeps, type GuideInput, type GuideRun, type StepState } from '@/project/guided/engine';
import { readPlan, type GuidedPlan, type StepGate } from '@/project/guided/plan';
import type { LearnerRecord } from '@/project/guided/record';
import { stripComments } from '@/project/guided/substance';
import { validatePlan } from '@/project/guided/validate-plan';
import { START_LABEL } from '@/studio/fork';
import type { LocalizedText } from '../../contracts/common';
import type { Project } from '../../contracts/project';
import type { SessionStep } from '../types';
import { stepTargets, type Describe } from './targets';

/** The steps of a project whose plan is missing or broken: no gates, so the learner marks each one (useGuide.ts). */
const MANUAL_PLAN: GuidedPlan = { v: 1, mode: 'guided', rung: 'lesson', skill: [], gates: [], complete: [], tests: [] };

/** The plan when it is valid; null for none or a broken one (useGuide.ts `readValidPlan`). */
export function readValidPlan(project: Project): GuidedPlan | null {
  try {
    const plan = readPlan(project);
    if (plan === null) return null;
    return validatePlan(plan, project).some((i) => i.severity === 'error') ? null : plan;
  } catch {
    return null;
  }
}

/** The Studio's `GuideDeps` (GuideMount.tsx). The headset has no legacy figure, so legacy-state gates are blocked. */
export function guideDeps(doc: () => Project): GuideDeps {
  return {
    sha256: sha256Hex,
    canonical: canonicalize,
    codeOnly: stripComments,
    stateMatches,
    connected: (a, b) => {
      const has = (net: Project['nets'][number], pin: { c: string; p: string }) => net.connections.some((end) => end.c === pin.c && end.p === pin.p);
      return doc().nets.some((net) => has(net, a) && has(net, b));
    },
    partCount: (definition) => doc().components.filter((c) => c.definition.ref === definition).length,
    // No lesson gate asks for a parameter to have moved from its default, so none can be judged (as the Studio).
    paramValue: () => undefined,
    legacyState: () => null,
  };
}

export interface Evaluated {
  readonly steps: readonly StepState[];
  readonly flips: readonly number[];
  readonly completion: CompletionResult | null;
}

/** Text as LocalizedText: a plain string is English. */
export const localized = (t: string | Record<string, string | undefined> | undefined): LocalizedText =>
  t === undefined ? {} : typeof t === 'string' ? { en: t } : (t as LocalizedText);

/** Assembly steps (a tour or a bench) or lesson steps. */
const usesAssembly = (doc: Project) => (doc.guide?.kind === 'tour' || doc.guide?.kind === 'bench') && (doc.guide.assembly?.length ?? 0) > 0;

export function stepCountOf(doc: Project): number {
  return (usesAssembly(doc) ? doc.guide?.assembly?.length : doc.guide?.steps?.length) ?? 0;
}

/** Steps the engine does not count (a bench's assembly): done when the record has them, the first other one current. */
function manualStates(count: number, record: LearnerRecord | undefined): StepState[] {
  let found = false;
  return Array.from({ length: count }, (_, index): StepState => {
    const latched = record?.steps[String(index)];
    if (latched) return { index, state: 'done', by: latched.by };
    const state = found ? 'notStarted' : 'current';
    found = true;
    return { index, state, by: null };
  });
}

/**
 * The headset has no legacy 2D figure, so a tour's legacy-state gates (which the engine holds as blocked for ever) become
 * manual ones: the learner ticks those steps with Next, as the Studio does for a project with no figure.
 */
export function withoutLegacyGates(plan: GuidedPlan): GuidedPlan {
  if (!plan.gates.some((g) => g.kind === 'legacy-state')) return plan;
  return { ...plan, gates: plan.gates.map((g): StepGate => (g.kind === 'legacy-state' ? { step: g.step, kind: 'manual' } : g)) };
}

export function evaluateLesson(
  doc: Project,
  plan: GuidedPlan | null,
  record: LearnerRecord | undefined,
  run: GuideRun,
  deps: GuideDeps,
  localActor: string,
): Evaluated {
  const startRevision = doc.history.checkpoints.find((c) => c.label === START_LABEL)?.revision ?? 0;
  const input: GuideInput = {
    project: doc,
    plan: plan === null ? MANUAL_PLAN : withoutLegacyGates(plan),
    record,
    run,
    activeFaults: activeFaults(doc),
    history: { startRevision, localActor, ops: doc.history.ops.map((e) => ({ revision: e.seq, actor: e.author.actor, kind: e.op.k })) },
  };
  const count = stepCountOf(doc);
  let { steps, flips } = evaluateSteps(input, deps);
  if (steps.length !== count) {
    steps = manualStates(count, record);
    flips = [];
  }
  return { steps, flips, completion: plan === null ? null : evaluateCompletion(input, deps) };
}

/** Project fault ids switched on (`simulation.faults[].enabled`), as the Studio's `activeFaultIds`. */
export function activeFaults(doc: Project): string[] {
  return doc.simulation.faults.filter((f) => f.enabled).map((f) => f.id);
}

/** A gate the bench can tick. Manual gates need Next; legacy-state gates need the 2D figure, which the headset lacks. */
const benchGate = (g: StepGate | undefined) => g !== undefined && g.kind !== 'manual' && g.kind !== 'legacy-state';

type AssemblyStep = { id?: string; title?: string | LocalizedText; body?: string | LocalizedText };

/** The steps without their states: ids, text, gates and targets. Recomputed when the document changes. */
export function stepList(doc: Project, plan: GuidedPlan | null, describe: Describe): Array<Omit<SessionStep, 'state'>> {
  const gates = new Map((plan?.gates ?? []).map((g) => [g.step, g]));
  const assembly = usesAssembly(doc);
  const raw = assembly ? ((doc.guide?.assembly ?? []) as AssemblyStep[]) : (doc.guide?.steps ?? []).map((t) => ({ body: t }) as AssemblyStep);
  return raw.map((s, index) => {
    const text = localized(s.body);
    return {
      index,
      id: s.id ?? `step-${index}`,
      kind: assembly ? 'assembly' : 'text',
      title: s.title === undefined ? null : localized(s.title),
      text,
      gated: benchGate(gates.get(index)),
      targets: stepTargets(doc, text.en ?? '', describe),
      problem: null,
      // Build steps come with build mode; a text step has nothing Do it for me can do on the bench.
      canDo: false,
    };
  });
}

/** iynk's hint levels (`checks-model.ts` `hintLevels`), kept in every language: the first two, then the rest as level 3. */
export function hintLevels(hints: ReadonlyArray<string | LocalizedText>): Array<{ level: number; text: LocalizedText }> {
  const texts = hints.map((h) => localized(h));
  const levels = texts.slice(0, 2).map((text, i) => ({ level: i + 1, text }));
  const rest = texts.slice(2);
  if (rest.length === 0) return levels;
  const langs = [...new Set(rest.flatMap((t) => Object.keys(t)))] as Array<keyof LocalizedText>;
  const joined: LocalizedText = Object.fromEntries(langs.map((l) => [l, rest.map((t) => t[l] ?? t.en ?? '').join('\n\n')]));
  return [...levels, { level: 3, text: joined }];
}
