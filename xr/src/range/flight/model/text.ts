/**
 * What the bench says, in the person's language. The English text is the figure engine's (`MSG` and `LOG` in
 * `figures/engine/drone.js`, kept equal by `xr/test/range-bench-parity.test.ts`) or the craft's own wording; the other
 * five languages come from `src/i18n/figures/<lang>.json`, keyed by that English text, loaded only when asked for.
 */
import type { Lang } from '../../../contracts/common';
import type { BenchCraft, BenchMessage } from './types';

export const BENCH_MSG: Readonly<Record<string, string>> = {
  live: 'Unplug the battery first: never work on a live quad',
  exploded: 'Close the exploded view first',
  busy: 'Wait for the test to finish',
  already: '{short} is already on',
  after: '{short} goes on after {need}',
  propsLast: 'Props go on LAST: run the smoke stopper test and the motor direction check first',
  notOn: '{short} is not on',
  takeOff: 'Take the {dep} off first',
  off: '{short} is off',
  built: 'Already built',
  box: 'Already a box of parts',
  buildDone: 'Built: every part on the right way round, the checks marked passed (not run)',
  plugNeeds: 'Mount the battery and its power lead first',
  pop: 'POP: the capacitor was in backwards and vented. A smoke stopper would have caught it. Unplug, replace it',
  powered: 'Beep beep beep: ESCs armed-ready, FC and VTX on',
  unplugged: 'Battery unplugged',
  faultFix: 'Fix the fault first (unplug, replace the capacitor)',
  smokeNeeds: 'Solder the power lead and the ESC first',
  smokeShort: 'The smoke stopper lamp lit up: something is shorted. The cap is in backwards: flip it before you plug in for real',
  smokeOk: 'No short: the lamp only blinked. Safe to plug in',
  noMotors: 'Nothing to spin on this craft',
  motorNeeds: 'Wire the motors and mount the flight controller first',
  propsOff: 'PROPS OFF! Never spin motors on the bench with props on',
  needBatt: 'Plug in a battery (USB alone can’t spin motors)',
  motorWrong: '{m} spun the wrong way: reversed it in the ESC configurator. They all spin right now',
  motorsOk: 'Every motor spins the right way',
  calNeeds: 'Mount the flight controller first',
  calBack: 'Calibrated level. Note: the arrow on the FC points backwards, so it will flip on take-off',
  calOk: 'Accelerometer calibrated on a flat surface',
  explodeOn: 'Exploded view: every part lifted on its own layer',
};

export const BENCH_LOG: Readonly<Record<string, string>> = {
  head: '-- {log} --',
  plugged: 'battery plugged: {v} V',
  unplugged: 'battery unplugged',
  pop: 'POP: input capacitor vented (fitted backwards)',
  smoke: '$ smoke stopper between battery and quad...',
  smokeShort: 'smoke stopper: SHORT detected',
  smokeOk: 'smoke stopper: no short, current ok',
  motors: '$ motors tab: spin {list} one at a time',
  reversed: '{m} direction reversed in ESC config',
  calBack: 'acc calibrated (but board_align is wrong!)',
  calOk: '$ calibrate accelerometer: done, level = 0.0 / 0.0',
  auto: '$ build it for me: every part on, checks marked passed (not run)',
  capNew: 'new capacitor fitted',
};

/** English text keyed to its translation, one language. */
export type FigureText = Readonly<Record<string, string>>;

/** Loads one language's figure strings (nothing to load for English). */
export async function loadFigureText(lang: Lang): Promise<FigureText> {
  switch (lang) {
    case 'en':
      return {};
    case 'de':
      return (await import('@/i18n/figures/de.json')).default;
    case 'es':
      return (await import('@/i18n/figures/es.json')).default;
    case 'fr':
      return (await import('@/i18n/figures/fr.json')).default;
    case 'hi':
      return (await import('@/i18n/figures/hi.json')).default;
    case 'zh':
      return (await import('@/i18n/figures/zh.json')).default;
  }
}

/** The English text of a message for this craft: its own wording, else the engine's. */
export function englishOf(msg: Pick<BenchMessage, 'kind' | 'key'>, craft: BenchCraft): string | undefined {
  return msg.kind === 'say' ? (craft.messages?.[msg.key] ?? BENCH_MSG[msg.key]) : (craft.logs?.[msg.key] ?? BENCH_LOG[msg.key]);
}

const lowerOf = (s: string, lang: Lang) => s.toLocaleLowerCase(lang === 'zh' ? 'zh-Hans' : lang);

/** A message as text in `lang`, with `text` that language's figure strings (from `loadFigureText`). */
export function benchText(msg: BenchMessage, craft: BenchCraft, lang: Lang, text: FigureText): string {
  const tr = (en: string) => (lang === 'en' ? en : (text[en] ?? en));
  const en = englishOf(msg, craft) ?? msg.key;
  return tr(en).replace(/\{(\w+)\}/g, (all, name: string) => {
    const v = msg.vars?.[name];
    if (v === undefined) return all;
    if (typeof v !== 'object') return String(v);
    const short = tr(craft.parts.find((p) => p.id === v.part)?.short ?? v.part);
    return v.lower ? lowerOf(short, lang) : short;
  });
}
