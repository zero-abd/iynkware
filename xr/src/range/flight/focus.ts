/**
 * The bench part the crash card sends the person back to ("Fix on the bench"): a part id of the craft, or null. The
 * crash card sets it before going to the bench; the bench highlights that part and its plate for a few seconds on
 * arrival, then clears it. One slot per app.
 */
import type { XrApp } from '../../contracts/app';
import { value, type Value } from '../../ui/value';

const slots = new WeakMap<object, Value<string | null>>();

export function benchFocusOf(app: Pick<XrApp, 'world'>): Value<string | null> {
  let v = slots.get(app.world);
  if (!v) {
    v = value<string | null>(null);
    slots.set(app.world, v);
  }
  return v;
}
