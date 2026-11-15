/**
 * The pure parts of the rail: which plates are enabled, and the ticker line for an undo or a redo. The project store
 * does not hand out the history entry's label, so the line names what the change touched, read from the ops the undo
 * or redo applied (`whatOf`), in the person's language. Pure.
 */
import type { Lang } from '../../contracts/common';
import type { Op } from '../../contracts/project';
import { tr } from '../core/text';
import { RAIL_STRINGS, type RailStringKey } from './strings';

/** Undo and Redo are greyed when there is nothing to undo or redo. */
export const railEnabled = (canUndo: boolean, canRedo: boolean): { undo: boolean; redo: boolean } => ({ undo: canUndo, redo: canRedo });

/** The string key of what a batch of ops touched, the most specific first. */
export function whatOf(ops: readonly Pick<Op, 'k'>[]): RailStringKey {
  const kinds = new Set(ops.map((o) => o.k as string));
  const has = (re: RegExp) => [...kinds].some((k) => re.test(k));
  if (kinds.has('wire.add') || kinds.has('wire.remove')) return 'rail.what.wire';
  if (kinds.has('wire.set')) return 'rail.what.wireColour';
  if (kinds.has('wire.route')) return 'rail.what.wireBend';
  if (has(/^(component|view\.(place|unplace))\./) || kinds.has('view.place') || kinds.has('view.unplace')) return 'rail.what.part';
  if (has(/^board\./)) return 'rail.what.board';
  return 'rail.what.change';
}

/** "Undid: wire" / "Redid: wire", in `lang`. */
export function tickerText(lang: Lang, kind: 'undo' | 'redo', ops: readonly Pick<Op, 'k'>[]): string {
  return tr(RAIL_STRINGS, lang, kind === 'undo' ? 'rail.undid' : 'rail.redid', { what: tr(RAIL_STRINGS, lang, whatOf(ops)) });
}
