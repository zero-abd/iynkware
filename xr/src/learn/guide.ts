/**
 * A fake lesson guide other pillars can code against before the learn pillar lands the real one: it turns the
 * project's own `guide.callouts` into one step with highlights, and its checks never run. Contract: contracts/lesson.ts.
 */
import type { Lang, LocalizedText } from '../contracts/common';
import type { LessonGuide, LessonGuideState } from '../contracts/lesson';
import type { Project } from '../contracts/project';
import type { BoardTarget } from '../contracts/space';

export function calloutTargets(doc: Project): Array<{ target: BoardTarget; text: LocalizedText }> {
  const byRefdes = new Map<string, string>();
  for (const x of [...doc.components, ...doc.boards]) byRefdes.set(x.refdes, x.id);
  const callouts = (doc.guide as { callouts?: Array<{ target: string; text: LocalizedText }> } | undefined)?.callouts ?? [];
  return callouts.flatMap((c) => {
    const part = byRefdes.get(c.target);
    return part ? [{ target: { kind: 'part' as const, part }, text: c.text }] : [];
  });
}

export function createFakeGuide(doc: Project, lang: Lang = 'en'): LessonGuide {
  const fns = new Set<(s: LessonGuideState) => void>();
  const callouts = calloutTargets(doc);
  let state: LessonGuideState = {
    lessonId: `project:${doc.id}`,
    title: (doc.meta as { title?: LocalizedText }).title ?? { en: doc.id },
    lang,
    steps: [{ id: 'look', text: { en: 'Look at the parts and press Run.' }, status: 'current', highlights: callouts.map((c) => ({ target: c.target, tone: 'info' as const })) }],
    current: 0,
    callouts,
    checks: { status: 'idle', results: [] },
    done: false,
  };
  const set = (next: LessonGuideState) => {
    state = next;
    fns.forEach((fn) => fn(state));
  };
  return {
    get state() {
      return state;
    },
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    next: () => undefined,
    back: () => undefined,
    runChecks: async () => undefined,
    setLang: (l) => set({ ...state, lang: l }),
  };
}
