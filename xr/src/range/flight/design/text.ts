/**
 * iynk's `dronelab` namespace (the design checks, the numbers' labels, the arming rules and their states), loaded per
 * language the way `loadFlightText` loads `flight`. Keys are dotted: `design.checks.over-spin`, `fly.rules.built`.
 */
import type { Lang } from '../../../contracts/common';
import { flightText } from '../../shared';

type Messages = Readonly<Record<string, unknown>>;
const modules = import.meta.glob<{ default: Messages }>('../../../../../src/i18n/messages/*/dronelab.json');
const cache = new Map<Lang, Promise<Messages>>();

export function loadDroneLabText(lang: Lang): Promise<Messages> {
  let p = cache.get(lang);
  if (!p) {
    const load = modules[`../../../../../src/i18n/messages/${lang}/dronelab.json`] ?? modules['../../../../../src/i18n/messages/en/dronelab.json'];
    p = load ? load().then((m) => m.default) : Promise.resolve({});
    cache.set(lang, p);
  }
  return p;
}

export type Say = (key: string, params?: Readonly<Record<string, string | number>>) => string;

/** A `Say` over a loaded namespace: the dotted key itself when iynk has no such text. */
export const sayOf =
  (messages: Messages): Say =>
  (key, params) =>
    flightText(messages, key, params);
