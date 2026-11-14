/**
 * The lesson launcher slot. `app.ts` builds `XrApp.lessons` and `XrApp.guide` from it before any feature mounts; the
 * learn pillar plugs in opening and closing when its module mounts (`lessonSlot(app).attach(...)`). An `open` made
 * before that waits for it, so Home or onboarding can open a lesson in any mount order. The catalogue's visibility is
 * a value here that the catalogue sub-module draws. Contract: contracts/lesson.ts.
 */
import type { XrApp } from '../contracts/app';
import type { LocalizedText, Unsubscribe } from '../contracts/common';
import type { CatalogueLab, LessonGuide, LessonLauncher } from '../contracts/lesson';
import { value, type Value } from '../ui/value';
import type { LessonSession } from './types';

/** What the learn session plugs in. */
export type LauncherImpl = Pick<LessonLauncher, 'open' | 'close'>;

export interface LessonSlot extends LessonLauncher {
  /** `XrApp.guide`, writable here: the session sets it while a lesson is open. */
  readonly guide: Value<LessonGuide | null>;
  /** `last`, writable here. */
  readonly lastValue: Value<{ templateId: string; title: LocalizedText } | null>;
  /** The open lesson's session, for learn's sub-modules. */
  readonly session: Value<LessonSession | null>;
  /** Which catalogue shows: one lab, `all`, or null when hidden. */
  readonly catalogue: Value<CatalogueLab | 'all' | null>;
  /** Plugs in open and close and replays an open that waited. Returns the detach; a second attach replaces the first. */
  attach(impl: LauncherImpl): Unsubscribe;
}

export function createLessonSlot(): LessonSlot {
  const guide = value<LessonGuide | null>(null);
  const last = value<{ templateId: string; title: LocalizedText } | null>(null);
  const session = value<LessonSession | null>(null);
  const catalogue = value<CatalogueLab | 'all' | null>(null);
  let impl: LauncherImpl | null = null;
  const waiting: Array<(i: LauncherImpl) => void> = [];
  const call = (fn: (i: LauncherImpl) => void) => {
    if (impl) fn(impl);
    else waiting.push(fn);
  };
  return {
    guide,
    lastValue: last,
    last,
    session,
    catalogue,
    showCatalogue: (lab?: CatalogueLab) => catalogue.set(lab ?? 'all'),
    hideCatalogue: () => catalogue.set(null),
    close: () => call((i) => i.close()),
    open: (templateId, opts) => new Promise<void>((resolve, reject) => call((i) => void i.open(templateId, opts).then(resolve, reject))),
    attach(next) {
      impl = next;
      for (const fn of waiting.splice(0)) fn(next);
      return () => {
        if (impl === next) impl = null;
      };
    },
  };
}

/** The slot behind `app.lessons`, for learn's sub-modules only (other pillars use `app.lessons` and `app.guide`). */
export function lessonSlot(app: XrApp): LessonSlot {
  return app.lessons as LessonSlot;
}
