import { describe, expect, it } from 'vitest';
import { nextHint, nextQuestion, openHints, openReason, stepsCard } from '../../src/learn/lessons/panel/finish';
import { PANEL_STRINGS } from '../../src/learn/lessons/panel/strings';
import { tableProblems } from '../../src/learn/text';
import type { LessonSessionState, SessionQuiz, SessionStep, StepState } from '../../src/learn/types';

const step = (i: number, state: StepState): SessionStep => ({ index: i, id: `s${i}`, kind: 'text', title: null, text: { en: `Step ${i}` }, state, gated: false, targets: [], problem: null, canDo: false });
const quiz = (id: string, afterStep: string | null, chosen: Array<number | null>): SessionQuiz => ({
  id,
  afterStep,
  questions: chosen.map((c, i) => ({ id: `q${i}`, q: { en: 'Q' }, options: [{ en: 'a' }, { en: 'b' }], answer: 1, why: { en: 'Because' }, chosen: c })),
});
const state = (over: Partial<LessonSessionState>): LessonSessionState =>
  ({
    steps: [step(0, 'done'), step(1, 'current')],
    viewIndex: 1,
    quizzes: [],
    hints: [],
    hintsOpened: 0,
    completion: { complete: false, open: ['checks', 'quiz'] },
    done: false,
    ...over,
  }) as LessonSessionState;
const none = new Set<string>();

describe('which card the Steps tab shows', () => {
  it('shows the step when no quiz is due', () => {
    expect(stepsCard(state({ quizzes: [quiz('z', null, [null])] }), none, null).kind).toBe('step');
  });

  it('shows a quiz without a step once every step is done and a question is unanswered', () => {
    const s = state({ steps: [step(0, 'done'), step(1, 'done')], quizzes: [quiz('z', null, [1, null])] });
    const c = stepsCard(s, none, null);
    expect(c.kind === 'quiz' && c.index).toBe(1);
  });

  it('shows the quiz that follows the viewed step once that step is done', () => {
    const s = state({ viewIndex: 0, quizzes: [quiz('z', 's0', [null])] });
    expect(stepsCard(s, none, null).kind).toBe('quiz');
    expect(stepsCard(state({ viewIndex: 1, quizzes: [quiz('z', 's0', [null])] }), none, null).kind).toBe('step');
    expect(stepsCard(state({ steps: [step(0, 'current'), step(1, 'notStarted')], viewIndex: 0, quizzes: [quiz('z', 's0', [null])] }), none, null).kind).toBe('step');
  });

  it('keeps the answered question up until it is dismissed, then goes back to the steps', () => {
    const s = state({ steps: [step(0, 'done'), step(1, 'done')], quizzes: [quiz('z', null, [1])] });
    expect(stepsCard(s, none, null).kind).toBe('step');
    const shown = stepsCard(s, none, { quizId: 'z', questionId: 'q0' });
    expect(shown.kind === 'quiz' && shown.answered).toBe(true);
    expect(stepsCard(s, new Set(['z']), null).kind).toBe('step');
  });

  it('shows a stored answer as answered when the quiz sits after the viewed step', () => {
    const s = state({ viewIndex: 0, quizzes: [quiz('z', 's0', [0, 1])] });
    const c = stepsCard(s, none, null);
    expect(c.kind === 'quiz' && [c.index, c.answered]).toEqual([1, true]);
  });

  it('goes to the next unanswered question, then back to the steps', () => {
    expect(nextQuestion(quiz('z', null, [1, null]))).toBe(1);
    expect(nextQuestion(quiz('z', null, [1, 0]))).toBeNull();
  });
});

describe('what is left', () => {
  it('is the first open reason, one at a time', () => {
    expect(openReason(state({}))).toBe('checks');
  });
  it('is nothing when the lesson is done, complete, or has no plan', () => {
    expect(openReason(state({ done: true }))).toBeNull();
    expect(openReason(state({ completion: { complete: true, open: [] } }))).toBeNull();
    expect(openReason(state({ completion: null }))).toBeNull();
  });
});

describe('hints', () => {
  const hints = [1, 2, 3].map((level) => ({ level, text: { en: `Hint ${level}` } }));
  it('reveals the next level, then none', () => {
    expect(nextHint(state({ hints, hintsOpened: 0 }))).toBe(1);
    expect(nextHint(state({ hints, hintsOpened: 2 }))).toBe(3);
    expect(nextHint(state({ hints, hintsOpened: 3 }))).toBeNull();
    expect(nextHint(state({ hints: [] }))).toBeNull();
  });
  it('lists the levels already open', () => {
    expect(openHints(state({ hints, hintsOpened: 2 })).map((h) => h.level)).toEqual([1, 2]);
  });
});

describe('the panel words', () => {
  it('exist in all six languages', () => {
    expect(tableProblems(PANEL_STRINGS)).toEqual([]);
  });
});
