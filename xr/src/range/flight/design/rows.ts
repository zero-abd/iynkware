/**
 * What the design panel says, as plain rows (no three.js): the calculator's numbers, the design checks with their
 * level, and the arming checklist with each rule's state. The sheet draws them; the tests read them.
 */
import type { ArmRule } from '@/lib/dronelab/bench';
import type { DesignView, LevelledCheck } from '../model';
import type { Say } from './text';

export interface Words {
  /** iynk's `dronelab` text. */
  readonly say: Say;
  /** This panel's own table. */
  readonly own: (key: 'price' | 'thrust' | 'more', params?: Readonly<Record<string, string | number>>) => string;
}

/** A number to `digits` places, without trailing noise ("12.5", "513"). */
export function num(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '-';
  return String(Number(value.toFixed(digits)));
}

export interface LineRow {
  readonly id: 'auw' | 'thrust' | 'tw' | 'hoverThr' | 'maxA' | 'hoverMin' | 'flyMin' | 'price';
  readonly label: string;
  readonly value: string;
}

/** The numbers, in the order the panel lays them out (two columns, four rows). */
export function designLines(view: DesignView, w: Words): LineRow[] {
  const grounded = view.thrustToWeight < 1 || view.hoverThrottle > 1;
  const minutes = (v: number) => (grounded ? w.say('design.units.none') : w.say('design.units.min', { value: num(v, 1) }));
  return [
    { id: 'auw', label: w.say('design.tiles.auw'), value: w.say('design.units.g', { value: num(view.weight, 0) }) },
    { id: 'thrust', label: w.own('thrust'), value: w.say('design.units.g', { value: num(view.thrustPerMotor, 0) }) },
    { id: 'tw', label: w.say('design.tiles.tw'), value: w.say('design.units.tw', { value: num(view.thrustToWeight, 1) }) },
    { id: 'hoverThr', label: w.say('design.tiles.hoverThr'), value: w.say('design.units.pct', { value: num(view.hoverThrottle * 100, 0) }) },
    { id: 'maxA', label: w.say('design.tiles.maxA'), value: w.say('design.units.a', { value: num(view.maxAmps, 0) }) },
    { id: 'hoverMin', label: w.say('design.tiles.hoverMin'), value: minutes(view.hoverMinutes) },
    { id: 'flyMin', label: w.say('design.tiles.flyMin'), value: minutes(view.flyMinutes) },
    {
      id: 'price',
      label: w.own('price'),
      value: view.price === null ? w.say('design.units.none') : w.say('design.cost.money', { value: num(view.price, 0) }),
    },
  ];
}

/** iynk's sentence for a design check (`design.checks.<code>`), numbers as the 2D page rounds them. */
export function checkText(c: LevelledCheck, say: Say): string {
  switch (c.code) {
    case 'over-spin':
      return say('design.checks.over-spin', { kv: num(c.kv, 0), cells: c.cells });
    case 'weak':
      return say('design.checks.weak', { tw: num(c.tw, 1), minTW: num(c.minTW, 1) });
    case 'cannot-hover':
      return say('design.checks.cannot-hover', { tw: num(c.tw, 1) });
    case 'hover-high':
      return say('design.checks.hover-high', { pct: num(c.hoverThr * 100, 0) });
    case 'esc-overcurrent':
      return say('design.checks.esc-overcurrent', { perMotor: num(c.perMotorA, 0), esc: num(c.escA, 0) });
    case 'battery-overcurrent':
      return say('design.checks.battery-overcurrent', { maxA: num(c.maxA, 0), limit: num(c.limitA, 0) });
    case 'prop-clash':
      return say('design.checks.prop-clash', { span: num(c.spanMm, 0), chord: num(c.chordMm, 0) });
    case 'tail-heavy':
      return say('design.checks.tail-heavy');
    case 'short-flight':
      return say('design.checks.short-flight', { min: num(c.flyMin, 1) });
  }
}

export type CheckLevelName = LevelledCheck['level'];
export interface CheckRow {
  readonly code: string;
  readonly level: CheckLevelName;
  /** The level's word ("Problem", "Warning", "Note"). */
  readonly tag: string;
  readonly text: string;
}

const SEVERITY: Record<CheckLevelName, number> = { danger: 0, warn: 1, info: 2 };

/** The design checks, worst first (the calculator's order within a level). At most `max` rows: the rest become one "n more" row. */
export function checkRows(view: DesignView, w: Words, max = 3): CheckRow[] {
  const sorted = view.checks.map((c, i) => ({ c, i })).sort((a, b) => SEVERITY[a.c.level] - SEVERITY[b.c.level] || a.i - b.i);
  const rows = sorted.map(({ c }): CheckRow => ({ code: c.code, level: c.level, tag: w.say(`design.levels.${c.level}`), text: checkText(c, w.say) }));
  if (rows.length <= max) return rows;
  const rest = rows.length - (max - 1);
  const last = rows[max - 2]!;
  return [...rows.slice(0, max - 1), { code: 'more', level: last.level, tag: last.tag, text: w.own('more', { n: rest }) }];
}

/** The text said when no check fires. */
export const allGoodKey = 'design.allGood';

export type RuleState = 'ok' | 'blocked' | 'warn';
export interface RuleRow {
  readonly id: string;
  readonly state: RuleState;
  /** Icon in the look kit's set: a tick, a cross, a warning triangle. */
  readonly icon: 'checkCircle' | 'xCircle' | 'warning';
  readonly text: string;
  /** "OK", "blocks arming", "flies badly". */
  readonly word: string;
}

export const stateOf = (r: ArmRule): RuleState => (r.ok ? 'ok' : r.level === 'block' ? 'blocked' : 'warn');

/** The arming checklist: each rule with an icon and a word for its state, in `flyRules` order. */
export function checklistRows(rules: readonly ArmRule[], say: Say, max = 9): RuleRow[] {
  return rules.slice(0, max).map((r, i): RuleRow => {
    const state = stateOf(r);
    const text =
      r.id === 'mistakes'
        ? say('fly.rules.mistakes', { code: r.code ?? '' })
        : r.id === 'capFault'
          ? say('fly.rules.capFault', { part: r.part ?? 'XT60' })
          : say(`fly.rules.${r.id}`);
    return {
      id: r.id === 'mistakes' ? `mistakes:${r.code ?? i}` : r.id,
      state,
      icon: state === 'ok' ? 'checkCircle' : state === 'blocked' ? 'xCircle' : 'warning',
      text,
      word: say(state === 'ok' ? 'fly.ok' : state === 'blocked' ? 'fly.blocked' : 'fly.warning'),
    };
  });
}
