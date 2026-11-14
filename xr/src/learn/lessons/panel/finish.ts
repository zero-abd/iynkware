/**
 * What the guide panel still owes the person on the way to done (design 7.1 and 7.3): which card the Steps tab shows
 * (the viewed step or a quiz question), the line saying what is left, and the next hint. Pure, so it is tested without a
 * canvas.
 */
import type { IconName } from '../../kit/icons';
import type { LessonSessionState, OpenReason, SessionQuiz } from '../../types';

type Question = SessionQuiz['questions'][number];

/** The question the person just answered, kept on screen until they press Next question or Back to the steps. */
export interface QuizReview {
  readonly quizId: string;
  readonly questionId: string;
}

export type StepsCard =
  | { readonly kind: 'step' }
  | { readonly kind: 'quiz'; readonly quiz: SessionQuiz; readonly question: Question; readonly index: number; readonly answered: boolean };

const firstUnanswered = (q: SessionQuiz): number => q.questions.findIndex((x) => x.chosen === null);

/**
 * The quiz card when it is due: the question just answered (until dismissed); the quiz that follows the viewed step
 * once that step is done; any quiz with an unanswered question once every step is done. A quiz whose questions are all
 * answered still shows (its last question, answered) after its step, until the person goes back to the steps.
 */
export function stepsCard(s: LessonSessionState, dismissed: ReadonlySet<string>, review: QuizReview | null): StepsCard {
  const quizOf = (q: SessionQuiz, i: number): StepsCard => {
    const x = q.questions[i]!;
    return { kind: 'quiz', quiz: q, question: x, index: i, answered: x.chosen !== null };
  };
  if (review) {
    const q = s.quizzes.find((z) => z.id === review.quizId);
    const i = q?.questions.findIndex((x) => x.id === review.questionId) ?? -1;
    if (q && i >= 0 && q.questions[i]!.chosen !== null) return quizOf(q, i);
  }
  const view = s.steps[Math.max(0, Math.min(s.steps.length - 1, s.viewIndex))];
  if (view && view.state === 'done') {
    for (const q of s.quizzes) {
      if (q.questions.length === 0 || q.afterStep !== view.id || dismissed.has(q.id)) continue;
      const i = firstUnanswered(q);
      return quizOf(q, i >= 0 ? i : q.questions.length - 1);
    }
  }
  if (s.steps.length > 0 && s.steps.every((x) => x.state === 'done')) {
    for (const q of s.quizzes) {
      const i = firstUnanswered(q);
      if (i >= 0 && !dismissed.has(q.id)) return quizOf(q, i);
    }
  }
  return { kind: 'step' };
}

/** After an answer: the question to go to (the next unanswered one) or null for back to the steps. */
export function nextQuestion(quiz: SessionQuiz): number | null {
  const i = firstUnanswered(quiz);
  return i >= 0 ? i : null;
}

/** The first thing still open, one at a time; null when the lesson is done or iynk has no plan for it. */
export function openReason(s: LessonSessionState): OpenReason | null {
  if (s.done || !s.completion || s.completion.complete) return null;
  return s.completion.open[0] ?? null;
}

export const OPEN_ICON: Readonly<Record<OpenReason, IconName>> = {
  edit: 'code',
  quiz: 'info',
  checks: 'checks',
  fault: 'warn',
  steps: 'steps',
  goal: 'play',
  diagnosis: 'eye',
};

/** The hint level the Hints button reveals next, or null when every level is open. */
export function nextHint(s: LessonSessionState): number | null {
  const levels = s.hints.map((h) => h.level);
  const next = levels.find((l) => l > s.hintsOpened);
  return next ?? null;
}

/** The hints already open, newest last. */
export function openHints(s: LessonSessionState): LessonSessionState['hints'] {
  return s.hints.filter((h) => h.level <= s.hintsOpened);
}
