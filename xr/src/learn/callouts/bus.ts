/**
 * Show me: the guide panel asks the step highlights to replay (the 1.2 s pulse three times, then steady). One counter per
 * app, so the panel and the highlights never import each other's internals.
 */
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';

const listeners = new WeakMap<XrApp, Set<() => void>>();

const of = (app: XrApp) => {
  let set = listeners.get(app);
  if (!set) {
    set = new Set();
    listeners.set(app, set);
  }
  return set;
};

export function replayHighlights(app: XrApp): void {
  for (const fn of [...of(app)]) fn();
}

export function onReplay(app: XrApp, fn: () => void): Unsubscribe {
  of(app).add(fn);
  return () => of(app).delete(fn);
}
