/**
 * Coach observations from the app: the lab tutor's events and lab actions, project ops, the simulation's run state and
 * findings, and lesson steps, as compact English lines in the coach (coach.ts). Nothing here draws on the bench: the
 * companion reads these lines and comments when asked (the lab shows no pop-ups of its own).
 */
import type { FeatureModule } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import type { DocChange } from '../../contracts/project';
import { labOf } from '../../lab/context';
import { rangeProjectOf } from '../../range/shared/detect';
import { notesOf } from '../../lab/model/catalogue';
import { onLookFrame } from '../../look/runner';
import { agentOf } from '../hub';

/** One line for a project change: what was added or removed, by op kind. */
export function describeChange(c: DocChange, title: string): string | null {
  if (c.origin === 'load') return `opened project "${title}"`;
  const counts = new Map<string, number>();
  for (const op of c.ops) counts.set(op.k, (counts.get(op.k) ?? 0) + 1);
  const words: string[] = [];
  const name: Record<string, string> = {
    'component.add': 'part added',
    'board.add': 'board added',
    'component.remove': 'part removed',
    'board.remove': 'board removed',
    'wire.add': 'wire added',
    'wire.remove': 'wire removed',
    'view.place': 'part placed',
    'view.unplace': 'part taken off the bench',
    'source.edit': 'code edited',
    'component.set': 'part changed',
  };
  for (const [k, n] of counts) if (name[k]) words.push(`${n > 1 ? `${n} x ` : ''}${name[k]}`);
  if (words.length === 0) return null;
  const who = c.origin === 'ai' ? 'co-builder' : c.origin === 'undo' ? 'undo' : c.origin === 'redo' ? 'redo' : 'person';
  return `${who}: ${words.join(', ')}`;
}

export const coachModule: FeatureModule = {
  id: 'agent/coach',
  mount(app) {
    const hub = agentOf(app.world);
    const { coach } = hub;
    const offs: Unsubscribe[] = [];

    /**
     * A new place to work: a project opened, a lab opened or left. Nothing from the bench that closed is shown or sent
     * again (its turns, pointers and observations), and the first observation says where the person is now, so the
     * next answer is about this bench and not the last one.
     */
    const fresh = (now: string) => {
      hub.conversation.clear();
      hub.callouts.clear();
      coach.clear();
      coach.push({ kind: 'project', text: `now at ${now}; what was said about the previous bench no longer applies`, refs: [] });
    };
    const benchName = () => {
      const kind = rangeProjectOf(app.project.doc)?.kind;
      const bench = kind === 'drone' ? 'drone workbench' : kind ? `${kind} workbench` : 'circuit workbench';
      return `the ${bench} (${app.project.doc.meta.title})`;
    };

    const lab = labOf(app.world);
    if (lab) {
      offs.push(
        lab.store.subscribe((c) => {
          if (c.type === 'lab') fresh(lab.store.lab ? `the ${lab.store.lab} lab` : benchName());
        }),
        lab.feed.subscribe((e) => {
          const ref = e.equipmentId ? [`lab:${e.equipmentId}`] : [];
          const what = e.itemKind ?? 'experiment';
          // A safety mistake (severity hazard or escalate: gas on and unlit, an overload) counts as a hazard from its
          // first warning. It is an observation for the companion only: nothing pops up over the bench.
          const severity = e.itemKind && e.mistakeId ? notesOf(e.itemKind).mistakes[e.mistakeId]?.severity : undefined;
          if (e.kind === 'hazard' || (e.kind === 'warn' && (severity === 'escalate' || severity === 'hazard'))) {
            coach.push({ kind: 'hazard', text: `HAZARD at ${what}: ${e.text.en}`, refs: ref, say: e.text });
          } else if (e.kind === 'warn') coach.push({ kind: 'lab-mistake', text: `mistake at ${what}${e.mistakeId ? ` (${e.mistakeId})` : ''}: ${e.text.en}`, refs: ref, say: e.text });
          else if (e.kind === 'instruct') coach.push({ kind: 'lab-step', text: `step${e.stepId ? ` ${e.stepId}` : ''}: ${e.text.en}`, refs: ref, say: e.text });
        }),
        lab.store.subscribe((c) => {
          if (c.type !== 'apply' && c.type !== 'refuse') return;
          const kind = lab.store.get(c.id)?.kind ?? c.id;
          const v = c.action.value === undefined ? '' : ` ${String(c.action.value)}`;
          coach.push({ kind: 'lab-action', text: c.type === 'apply' ? `${kind}: ${c.action.type}${v}` : `${kind}: ${c.action.type}${v} refused (${c.reason})`, refs: [`lab:${c.id}`] });
        }),
      );
    }

    offs.push(
      app.project.subscribe((c) => {
        // A project is a new teaching context (a circuit, a drone, a lesson): start fresh, saying which bench this is.
        if (c.origin === 'load') fresh(benchName());
        const text = describeChange(c, app.project.doc.meta.title);
        if (text) coach.push({ kind: 'project', text, refs: [] });
      }),
      // Same project, another place (the drone bench and flying it in the Range): pointers on the bench go, and the
      // companion is told where the person is now; the conversation about this drone stays.
      app.shell.place.subscribe((place) => {
        hub.callouts.clear();
        const where = place === 'range' ? 'flying in the Range' : place === 'room' ? 'room size' : benchName();
        coach.push({ kind: 'project', text: `now at ${where}`, refs: [] });
      }),
      app.sim.onState((s) => {
        if (s === 'running' || s === 'paused' || s === 'idle' || s === 'done' || s === 'halted' || s === 'error') coach.push({ kind: 'sim', text: `simulation ${s}`, refs: [] });
      }),
      app.sim.onFindings((findings) => {
        for (const f of findings) {
          if (f.severity !== 'error') continue;
          const refs = f.targets.filter((t) => t.kind === 'part' || t.kind === 'pin').map((t) => `part:${t.id}`);
          coach.push({ kind: 'finding', text: `finding ${f.ruleId} (${f.severity})${refs.length ? ` on ${refs.join(', ')}` : ''}`, refs });
        }
      }),
    );

    let offGuide: Unsubscribe = () => undefined;
    let lastStep = '';
    offs.push(
      app.guide.subscribe((g) => {
        offGuide();
        offGuide = () => undefined;
        if (!g) return;
        offGuide = g.subscribe((st) => {
          const step = st.steps[st.current];
          const key = `${st.lessonId}:${st.current}`;
          if (!step || key === lastStep) return;
          lastStep = key;
          coach.push({ kind: 'lesson', text: `lesson step ${st.current + 1} of ${st.steps.length}: ${step.text.en ?? ''}`, refs: [] });
        });
      }),
      () => offGuide(),
      onLookFrame(app.world, () => coach.tick()),
    );
    return () => {
      for (const off of offs.splice(0)) off();
    };
  },
};
