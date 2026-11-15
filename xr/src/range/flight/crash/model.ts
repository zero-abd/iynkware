/** The crash card's logic with no scene in it: the card's lines, the fault's bench part, the timeline's marks. */
import type { BreakId, CrashFix } from '@/lib/flight';
import type { Lang } from '../../../contracts/common';
import { flightText } from '../../shared';
import type { ReplayMark, ReplayWindow } from '../core';
import { CRASH_STRINGS as S } from './strings';

type Flight = Readonly<Record<string, unknown>>;

/** The bench part (a sidecar part id) a fault is fixed at: the first of these the craft has. */
const PART_OF: Record<BreakId, readonly string[]> = {
  fcReversed: ['FC'],
  propsSwapped: ['PROPS'],
  motorDirUnchecked: ['MOTORS'],
  accUncalibrated: ['FC'],
  overKv: ['MOTORS'],
  servosReversed: ['SERVOS', 'FC'],
  tailHeavy: ['BATT'],
  propBackwards: ['PROPS'],
};

/** The bench part a fault is fixed at, or null when the craft has no such part. */
export function partOfFault(fault: BreakId, partIds: readonly string[]): string | null {
  return PART_OF[fault].find((id) => partIds.includes(id)) ?? null;
}

/** Room metres a second, one decimal. */
export const roomSpeed = (speed: number, k: number): string => (speed * k).toFixed(1);

/** What it hit, in words: a `hit.*` key, or the net. */
export function hitLine(win: Pick<ReplayWindow, 'hit'>, flight: Flight, lang: Lang): string {
  if (win.hit === 'net') return S.t(lang, 'netHit');
  return flightText(flight, `hit.${win.hit}`);
}

/** Why, in words: iynk's `why.*` (with what it hit and the speed), or the net's. */
export function causeLine(win: Pick<ReplayWindow, 'cause' | 'hit' | 'speed'>, flight: Flight, lang: Lang): string {
  if (win.cause === 'net') return S.t(lang, 'netCause');
  const what = win.hit === 'ground' ? '' : flightText(flight, `why.what.${win.hit}`);
  return flightText(flight, `why.${win.cause}`, { what, speed: win.speed.toFixed(1), kmh: Math.round(win.speed * 3.6) });
}

/** The fix, in words, from `fixFor`; `modeTitle` names a mode. */
export function fixLine(fix: CrashFix, flight: Flight, modeTitle: (mode: string) => string): string {
  switch (fix.kind) {
    case 'fault':
      return flightText(flight, `why.fix.${fix.fault}`);
    case 'mode':
      return flightText(flight, 'why.fix.mode', { mode: modeTitle(fix.mode) });
    case 'pace':
      return flightText(flight, 'why.fix.pace');
    default:
      return flightText(flight, 'why.fix.reset');
  }
}

export interface CardInput {
  readonly win: ReplayWindow;
  /** The course map's `k`: room metres per course metre. */
  readonly k: number;
  readonly flight: Flight;
  readonly lang: Lang;
  readonly modeTitle: (mode: string) => string;
  /** Show the cause instead of the fix. */
  readonly why?: boolean;
}

/** The card's text: what it hit, the room speed, then the fix (or the cause when Why is on). */
export function cardLines(i: CardInput): string[] {
  const { win, lang } = i;
  const last = i.why
    ? S.t(lang, 'whyLine', { cause: causeLine(win, i.flight, lang) })
    : S.t(lang, 'fixLine', { fix: fixLine(win.fix, i.flight, i.modeTitle) });
  return [hitLine(win, i.flight, lang), S.t(lang, 'speed', { speed: roomSpeed(win.speed, i.k) }), last];
}

/** A mark's short label. */
export function markLabel(mark: ReplayMark, lang: Lang): string {
  switch (mark.kind) {
    case 'crash':
      return S.t(lang, 'markCrash');
    case 'net':
      return S.t(lang, 'markNet');
    case 'gate':
      return S.t(lang, 'markGate', { n: (mark.index ?? 0) + 1 });
    case 'stick':
      return S.t(lang, 'markStick');
    case 'saturated':
      return S.t(lang, 'markSaturated');
    default:
      return S.t(lang, 'markSag');
  }
}

/** Where a time sits on a track `width` wide centred on 0: -width/2 at the start, +width/2 at the end. */
export function timelineX(t: number, duration: number, width: number): number {
  return duration <= 0 ? -width / 2 : (Math.min(duration, Math.max(0, t)) / duration - 0.5) * width;
}

/** The time under a point `x` (local, centred) on the track, clamped to the window. */
export function timeAtX(x: number, duration: number, width: number): number {
  return Math.min(1, Math.max(0, x / width + 0.5)) * duration;
}

/**
 * Rows for the mark labels so close neighbours do not overprint: each mark takes the first row whose last label ends
 * left of this one's start. `labelW` is a label's width.
 */
export function labelRows(xs: readonly number[], labelW: number, rows: number): number[] {
  const ends = new Array<number>(rows).fill(-Infinity);
  return xs.map((x) => {
    let r = ends.findIndex((e) => x - labelW / 2 >= e);
    if (r < 0) r = ends.indexOf(Math.min(...ends));
    ends[r] = x + labelW / 2;
    return r;
  });
}
