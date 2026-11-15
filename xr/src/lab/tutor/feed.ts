/**
 * The seam for a model-backed or voice tutor (a Gemini Live backend, issue #2): everything the deterministic tutor
 * knows, as events and as one compact JSON snapshot. Nothing here calls a network. The shape is documented in
 * docs/XR_LAB.md; `schema` changes when it does.
 *
 *   const feed = createTutorFeed(store, runner, tutor, () => lang);
 *   feed.subscribe((e) => backend.say(e));     // every TutorEvent, as the in-headset tutor says it
 *   const json = JSON.stringify(feed.snapshot());
 */
import type { Lang, Unsubscribe } from '../../contracts/common';
import { say } from '../text';
import { LAB_NAMES, notesOf } from '../model/catalogue';
import type { LabStore } from '../model/store';
import type { LabId, Prim, Report } from '../model/types';
import type { Runner } from '../experiments/runner';
import type { TutorEvent, TutorKind, Tutor } from './tutor';

export const SNAPSHOT_SCHEMA = 'iynkware.lab-snapshot/1';

export interface SnapshotNotes {
  readonly name: string;
  readonly summary: string;
  readonly safeUse: readonly string[];
  readonly hazards: readonly string[];
  readonly mistakes: Readonly<Record<string, { readonly when: string; readonly say: string; readonly severity: string }>>;
}

export interface LabSnapshot {
  readonly schema: typeof SNAPSHOT_SCHEMA;
  /** Lab clock, ms. */
  readonly at: number;
  /** The language the text fields are in. */
  readonly lang: Lang;
  readonly lab: { readonly id: LabId; readonly name: string } | null;
  readonly experiment: {
    readonly id: string;
    readonly title: string;
    readonly goal: string;
    readonly mode: 'practice' | 'exam';
    readonly step: { readonly id: string; readonly index: number; readonly of: number; readonly text: string; readonly hint: string | null } | null;
    readonly done: boolean;
    readonly answers: Readonly<Record<string, Prim>>;
    readonly score: number | null;
  } | null;
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly name: string;
    /** Millimetres on the bench table and degrees. */
    readonly pose: { readonly x: number; readonly z: number; readonly yaw: number };
    readonly report: Report;
    readonly mistake: string | null;
    readonly placeholder?: boolean;
  }>;
  readonly mistakes: ReadonlyArray<{ readonly itemId: string; readonly kind: string; readonly mistakeId: string; readonly severity: string; readonly sinceMs: number; readonly say: string }>;
  /** The notes for each kind on the bench, once each. */
  readonly notes: Readonly<Record<string, SnapshotNotes>>;
  readonly recent: ReadonlyArray<{ readonly kind: TutorKind; readonly text: string; readonly at: number; readonly itemKind: string | null; readonly mistakeId?: string }>;
}

export interface LabTutorFeed {
  subscribe(fn: (e: TutorEvent) => void): Unsubscribe;
  snapshot(lang?: Lang): LabSnapshot;
}

const RECENT_IN_SNAPSHOT = 5;

export function createTutorFeed(store: LabStore, runner: Runner, tutor: Tutor, lang: () => Lang): LabTutorFeed {
  return {
    subscribe: (fn) => tutor.subscribe(fn),
    snapshot(l = lang()) {
      const run = runner.state.value;
      const items = store.items();
      const notes: Record<string, SnapshotNotes> = {};
      for (const it of items) {
        if (notes[it.kind]) continue;
        const n = notesOf(it.kind);
        notes[it.kind] = {
          name: say(n.name, l),
          summary: say(n.summary, l),
          safeUse: n.safeUse.map((s) => say(s, l)),
          hazards: n.hazards.map((s) => say(s, l)),
          mistakes: Object.fromEntries(Object.entries(n.mistakes).map(([id, m]) => [id, { when: m.when, say: say(m.say, l), severity: m.severity }])),
        };
      }
      const exam = run?.mode === 'exam' && !run.done;
      return {
        schema: SNAPSHOT_SCHEMA,
        at: store.now,
        lang: l,
        lab: store.lab ? { id: store.lab, name: say(LAB_NAMES[store.lab], l) } : null,
        experiment: run
          ? {
              id: run.experiment.id,
              title: say(run.experiment.title, l),
              goal: say(run.experiment.goal, l),
              mode: run.mode,
              step: run.step
                ? { id: run.step.id, index: run.stepIndex, of: run.experiment.steps.length, text: say(run.step.text, l), hint: exam ? null : say(run.step.hint, l) }
                : null,
              done: run.done,
              answers: store.answers,
              score: run.result?.score ?? null,
            }
          : null,
        items: items.map((it) => ({
          id: it.id,
          kind: it.kind,
          name: it.label ?? say(notesOf(it.kind).name, l),
          pose: { x: Math.round(it.pose.x), z: Math.round(it.pose.z), yaw: Math.round(it.pose.yaw) },
          report: store.report(it.id) ?? {},
          mistake: store.mistake(it.id),
          ...(it.placeholder ? { placeholder: true } : {}),
        })),
        mistakes: [...tutor.active.entries()].map(([itemId, w]) => {
          const kind = store.get(itemId)?.kind ?? '';
          const m = notesOf(kind).mistakes[w.mistakeId];
          return { itemId, kind, mistakeId: w.mistakeId, severity: w.severity, sinceMs: store.now - w.since, say: m ? say(m.say, l) : '' };
        }),
        notes,
        recent: tutor.recent.slice(-RECENT_IN_SNAPSHOT).map((e) => ({ kind: e.kind, text: say(e.text, l), at: e.at, itemKind: e.itemKind, ...(e.mistakeId ? { mistakeId: e.mistakeId } : {}) })),
      };
    },
  };
}
