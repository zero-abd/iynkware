/**
 * Putting a part back on a shelf bin (design 3.2: "Delete is not its own gesture"): the part of the bench that is let go
 * over a bin shrinks into it and leaves the project, wires and all, in one undo. Shared by the part carry (`carry.ts`) and
 * the board move (`board.ts`); the shelf says where its bins are through `benchKit(app).bins`.
 */
import { Vector3 } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Hand } from '../../contracts/input';
import { createCallout } from '../../look/callout';
import { removePart, type ActionRefusal } from '../core/actions';
import { benchKit } from '../core/kit';
import type { Transitions } from './motion';
import { editStrings, reasonText } from './strings';
import { tr } from '../core/text';

/** How long the reason of a refused removal shows. */
const REASON_MS = 1500;

const _c = new Vector3();
const _w = new Vector3();

/** The bin under a point of the bench root's frame (a part's top), or -1. Allocates nothing. */
export function binUnder(app: XrApp, local: Vector3): number {
  _w.copy(local);
  app.bench.root.localToWorld(_w);
  return benchKit(app).bins.at(_w.x, _w.y, _w.z);
}

/** The reason a part could not leave, as a card at `at` (bench root frame). */
export function showRefusal(app: XrApp, refusal: Pick<ActionRefusal, 'reason' | 'args'>, at: Vector3, hand: Hand | null): void {
  const root = app.bench.root;
  const c = createCallout(reasonText(app.settings.lang.value, refusal), { tone: 'warn', distance: 0.65, shape: 'card' });
  c.group.scale.setScalar(1 / app.bench.scale.value);
  c.group.position.copy(at);
  c.group.position.y += 0.004;
  root.add(c.group);
  setTimeout(() => c.dispose(), REASON_MS);
  _w.copy(at);
  root.localToWorld(_w);
  benchKit(app).feedback.play('invalid', [_w.x, _w.y, _w.z], hand);
}

/**
 * Removes `id` (a part, a board or the breadboard) from the project in one change and shrinks it, and every item of
 * `riders` (the parts seated in a breadboard that goes with it), into bin `bin`. Returns the refusal when the document
 * says no (the only board stays); nothing has changed then and the caller sends the holds back.
 */
export function removeOnBin(app: XrApp, transitions: Transitions, id: string, riders: readonly string[], bin: number, hand: Hand | null): ActionRefusal | null {
  const kit = benchKit(app);
  const doc = app.project.doc;
  const r = removePart(doc, { part: id });
  if (!r.ok) return r;
  const name = [...doc.boards, ...doc.components].find((x) => x.id === id)?.refdes ?? id;
  kit.bins.centre(bin, _c);
  const at: [number, number, number] = [_c.x, _c.y, _c.z];
  app.bench.root.worldToLocal(_c);
  for (const g of new Set([id, ...riders])) {
    transitions.sink(g, _c);
    transitions.hold(g, false);
  }
  const res = app.project.apply(r.ops, { label: r.label });
  if (!res.ok) return { ok: false, reason: 'bad-args', args: {} };
  kit.feedback.play('seat', at, hand);
  kit.feedback.ticker(tr(editStrings, app.settings.lang.value, 'edit.removed', { name }));
  return null;
}
