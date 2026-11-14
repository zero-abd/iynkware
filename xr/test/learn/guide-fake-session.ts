/**
 * A fake `LessonSession` for the guide panel until the real session (#52) lands: the Uno Blink template's own steps,
 * title and checks, with bench targets on the steps so the highlights show. Not shipped; the Playwright walk imports it
 * from the dev server (`/test/learn/guide-fake-session.ts`).
 */
import { createFakeGuide } from '../../src/learn/guide';
import type { LessonSession, LessonSessionState, SessionCheck, SessionStep } from '../../src/learn/types';
import type { LocalizedText } from '../../src/contracts/common';
import type { Project } from '../../src/contracts/project';
import { value } from '../../src/ui/value';

type Guide = { title?: LocalizedText; lede?: LocalizedText; steps?: LocalizedText[] };
type Test = { checks: Array<{ id: string; kind: string; label: LocalizedText; visibility?: string }> };

const PROBLEM: LocalizedText = {
  en: 'The LED is in backwards: turn it round so the long leg goes to row 14.',
  de: 'Die LED steckt falsch herum: Dreh sie um, damit das lange Bein in Reihe 14 steckt.',
  hi: 'LED उल्टी लगी है: उसे घुमाएँ ताकि लंबी टाँग पंक्ति 14 में जाए।',
};

export function fakeSession(doc: Project): LessonSession & { patch(p: Partial<LessonSessionState>): void } {
  const g = (doc.guide ?? {}) as Guide;
  const texts = g.steps ?? [{ en: 'Look at the parts and press Run.' }];
  const steps: SessionStep[] = texts.map((text, index) => ({
    index,
    id: `step${index + 1}`,
    kind: index === 0 ? 'wire' : 'text',
    title: null,
    text,
    state: index === 0 ? 'current' : 'notStarted',
    gated: index === 1,
    targets:
      index === 0
        ? [
            { target: { kind: 'pin', part: 'brd_main', pin: 'D13' }, tone: 'do' },
            { target: { kind: 'hole', surface: 'cmp_bb', hole: 'a10' }, tone: 'do' },
          ]
        : index === 1
          ? [{ target: { kind: 'part', part: 'cmp_led1' }, tone: 'do' }]
          : index === 3
            ? [{ target: { kind: 'part', part: 'cmp_res1' }, tone: 'do', label: 'RES1' }]
            : [],
    problem: index === 1 ? PROBLEM : null,
    canDo: false,
  }));
  const tests = ((doc as unknown as { tests?: Test[] }).tests ?? [])[0]?.checks ?? [];
  const rows: SessionCheck[] = tests.map((c) => ({
    testId: 'main',
    checkId: c.id,
    label: c.label,
    kind: c.kind,
    state: 'notRun',
    hidden: c.visibility === 'hidden',
    textCheck: c.kind === 'code',
  }));
  const state = value<LessonSessionState>({
    templateId: doc.id,
    projectId: doc.id,
    kind: 'lesson',
    build: false,
    title: g.title ?? { en: doc.id },
    lede: g.lede ?? null,
    lang: 'en',
    steps,
    viewIndex: 0,
    checks: { status: 'idle', progress: 0, rows, error: null },
    completion: { complete: false, open: ['checks'] },
    done: false,
    quizzes: [],
    hints: [],
    hintsOpened: 0,
    activeFaults: [],
    kit: [],
  });
  const patch = (p: Partial<LessonSessionState>) => state.set({ ...state.value, ...p });
  const view = (i: number) => patch({ viewIndex: Math.max(0, Math.min(state.value.steps.length - 1, i)) });
  return {
    state,
    guide: createFakeGuide(doc),
    patch,
    view,
    back: () => view(state.value.viewIndex - 1),
    next() {
      const s = state.value;
      const i = s.viewIndex;
      const next = s.steps.map((st, j): SessionStep => {
        if (j === i && !st.gated) return { ...st, state: 'done' };
        if (j === i + 1 && st.state === 'notStarted') return { ...st, state: 'current' };
        return st;
      });
      patch({ steps: next, viewIndex: Math.min(next.length - 1, i + 1) });
    },
    doIt: () => undefined,
    async runChecks() {
      patch({ checks: { ...state.value.checks, status: 'running', rows: state.value.checks.rows.map((r) => ({ ...r, state: 'running' })) } });
      await new Promise((r) => setTimeout(r, 1500));
      patch({
        checks: {
          ...state.value.checks,
          status: 'done',
          progress: 1,
          rows: state.value.checks.rows.map((r, i) => (i === 1 ? { ...r, state: 'fail', detail: '1/2' } : { ...r, state: 'pass' })),
        },
      });
    },
    cancelChecks: () => undefined,
    answer: () => undefined,
    openHint: () => undefined,
    setLang: (lang) => patch({ lang }),
    reset: () => undefined,
    dispose: () => undefined,
  };
}
