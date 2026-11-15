/**
 * Coach observations from the app: the lab tutor's events and lab actions, project ops, the simulation's run state and
 * findings, and lesson steps, as compact English lines in the coach (coach.ts). A hazard from the lab tutor is also
 * shown at once as a warn callout from the item, with no brain or model involved (deterministic safety, #180).
 */
import type { FeatureModule } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import type { DocChange } from '../../contracts/project';
import { labOf } from '../../lab/context';
import { notesOf } from '../../lab/model/catalogue';
import { say } from '../../lab/text';
import { onLookFrame } from '../../look/runner';
import { agentOf } from '../hub';

/** How long the local hazard callout stays (it is put back while the tutor repeats the hazard). */
export const HAZARD_MS = 15_000;

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
    const lang = () => app.settings.lang.value;

    const lab = labOf(app.world);
    if (lab) {
      offs.push(
        lab.feed.subscribe((e) => {
          const ref = e.equipmentId ? [`lab:${e.equipmentId}`] : [];
          const what = e.itemKind ?? 'experiment';
          // A safety mistake (severity hazard or escalate: gas on and unlit, an overload) counts as a hazard from its
          // first warning: the local callout does not wait for the tutor to escalate it.
          const severity = e.itemKind && e.mistakeId ? notesOf(e.itemKind).mistakes[e.mistakeId]?.severity : undefined;
          if (e.kind === 'hazard' || (e.kind === 'warn' && (severity === 'escalate' || severity === 'hazard'))) {
            coach.push({ kind: 'hazard', text: `HAZARD at ${what}: ${e.text.en}`, refs: ref, say: e.text });
            if (e.equipmentId && e.itemKind) {
              hub.callouts.add({ kind: 'lab', id: e.equipmentId, itemKind: e.itemKind, name: say(notesOf(e.itemKind).name, lang()) }, say(e.text, lang()), 'warn', HAZARD_MS);
            }
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
        const text = describeChange(c, app.project.doc.meta.title);
        if (text) coach.push({ kind: 'project', text, refs: [] });
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
