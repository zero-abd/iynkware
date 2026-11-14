/**
 * Mounts the guide panel: it follows `lessonSlot(app).session`, shows while a lesson is open and goes when it closes.
 */
import type { XrApp } from '../../../contracts/app';
import type { Unsubscribe } from '../../../contracts/common';
import { lessonSlot } from '../../launcher';
import type { LessonSession } from '../../types';
import { createGuidePanel } from './guide-panel';

export function mountGuidePanel(app: XrApp): Unsubscribe {
  const slot = lessonSlot(app);
  let current: { session: LessonSession; off: Unsubscribe } | null = null;
  const sync = (s: LessonSession | null) => {
    if (current?.session === s) return;
    current?.off();
    current = s ? { session: s, off: createGuidePanel(app, s) } : null;
  };
  const off = slot.session.subscribe(sync);
  sync(slot.session.value);
  return () => {
    off();
    current?.off();
    current = null;
  };
}
