import type { ReadonlyValue, Unsubscribe } from '../contracts/common';

/** A tiny observable value that satisfies the contracts' `ReadonlyValue`. */
export interface Value<T> extends ReadonlyValue<T> {
  set(next: T): void;
}

export function value<T>(initial: T): Value<T> {
  let current = initial;
  const fns = new Set<(v: T) => void>();
  return {
    get value() {
      return current;
    },
    set(next: T) {
      if (Object.is(next, current)) return;
      current = next;
      for (const fn of [...fns]) fn(current);
    },
    subscribe(fn): Unsubscribe {
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };
}
