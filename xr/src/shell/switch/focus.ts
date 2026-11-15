/**
 * One shell panel in front at a time. Home, the menu, Projects and Settings all open about a metre ahead, so two open
 * together overlap and the nearer one takes the rays meant for the other. Each panel says when it opens
 * (`claimFocus`) and registers how to close itself (`onFocusLost`); opening one closes the others. Not a sub-module.
 *
 *   const off = onFocusLost(app, 'projects', () => close());
 *   const open = () => { claimFocus(app, 'projects'); ... };
 *
 * Keyed by `app.world`, like `switching` and `providePanel`, so every app (and every test) has its own.
 */
import type { Unsubscribe } from '../../contracts/common';

type Closer = { name: string; close: () => void };
const closers = new WeakMap<object, Set<Closer>>();

/** Anything with a `world` (an `XrApp`); only its identity is used. */
type Keyed = { readonly world: object };

function setOf(app: Keyed): Set<Closer> {
  let s = closers.get(app.world);
  if (!s) closers.set(app.world, (s = new Set()));
  return s;
}

/** `name` is opening: every other registered panel closes. Call before the panel shows itself. */
export function claimFocus(app: Keyed, name: string): void {
  for (const c of [...setOf(app)]) if (c.name !== name) c.close();
}

/** Registers how `name` closes when another panel claims focus; the returned function unregisters it. */
export function onFocusLost(app: Keyed, name: string, close: () => void): Unsubscribe {
  const entry: Closer = { name, close };
  setOf(app).add(entry);
  return () => {
    setOf(app).delete(entry);
  };
}
