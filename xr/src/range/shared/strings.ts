/**
 * Range's six-language strings. Each sub-module keeps its own table in its own `strings.ts` (two slices never edit
 * one file), made with `defineStrings` and checked in its test with `stringProblems`. The helpers are the run kit's
 * (`xr/src/run/kit/strings.ts`), which is the app's adapter until `app.text` lands (#19); when it does, the tables move
 * to `src/i18n/messages/<lang>/xrRange.json` and the call sites stay.
 *
 * iynk's own strings are reused where they fit: the bench's messages through `benchText` (figure strings), the
 * flight's `hit.*`, `why.*`, `msg.*` through `flightText` below.
 */
import type { Lang } from '../../contracts/common';
import type { XrApp } from '../../contracts/app';

export { defineStrings, fill, stringProblems, type Strings, type StringTable } from '../../run/kit/strings';

/** The person's language now. */
export const langOf = (app: Pick<XrApp, 'settings'>): Lang => app.settings.lang.value;

type Messages = Readonly<Record<string, unknown>>;
const flightModules = import.meta.glob<{ default: Messages }>('../../../../src/i18n/messages/*/flight.json');
const cache = new Map<Lang, Promise<Messages>>();

/** iynk's `flight` namespace for a language (`hit.tree`, `why.flipFc`, `msg.blocked.acc`), loaded on first use. */
export function loadFlightText(lang: Lang): Promise<Messages> {
  let p = cache.get(lang);
  if (!p) {
    const load = flightModules[`../../../../src/i18n/messages/${lang}/flight.json`] ?? flightModules['../../../../src/i18n/messages/en/flight.json'];
    p = load ? load().then((m) => m.default) : Promise.resolve({});
    cache.set(lang, p);
  }
  return p;
}

/** A dotted key (`hit.tree`) in a loaded `flight` namespace, with `{name}` filled; the key itself when it is missing. */
export function flightText(messages: Messages, key: string, params?: Readonly<Record<string, string | number>>): string {
  let v: unknown = messages;
  for (const part of key.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[part] : undefined;
  if (typeof v !== 'string') return key;
  return params ? v.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all)) : v;
}
