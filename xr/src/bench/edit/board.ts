/**
 * Moving a whole board or the breadboard on the mat (design 3.2, 3.4.9): grab its edge band (hands) or anywhere with a
 * controller grip, and it follows the hand level; the parts seated in a breadboard ride with it. Released on the mat it
 * moves in the document (`movePart`, one undo); released off the mat it goes back. Wires follow when the document does.
 */
import { Matrix4, Vector3 } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import { motionOf } from '../../look/runner';
import { movePart, partOrigin } from '../core/actions';
import { benchGeometry } from '../core/geometry';
import { benchKit } from '../core/kit';
import { createTrackingLoss } from '../core/gesture';
import type { BenchPress } from '../core/router';
import { benchInternals } from '../space';
import { holdPointOf } from './hand';
import type { Holder } from './carry';
import { RETURN_MS } from './carry';
import type { Transitions } from './motion';
import { matOf, onMatRect } from './place';
import { reasonText } from './strings';

const _hold = new Vector3();
const _M = new Matrix4();
const _t = new Vector3();

export function createBoardHolder(app: XrApp, transitions: Transitions, press: BenchPress): Holder | null {
  const bi = benchInternals(app.bench);
  const item = bi?.items.get(press.item);
  if (!bi || !item || item.role === 'part' || !press.hand) return null;
  const hand = press.hand;
  const point = holdPointOf(app, hand, press.near, press.start.point);
  if (!point) return null;
  // what moves: the board, and the parts seated in the breadboard
  const group = [item, ...(item.role === 'surface' ? [...bi.items.values()].filter((i) => i.role === 'part' && i.seated) : [])];
  const bases = group.map((g) => g.object.position.clone());
  const motion = motionOf(app.world);
  for (const g of group) {
    motion.cancel(g.object);
    transitions.hold(g.id, true);
  }
  const loss = createTrackingLoss();
  let isDone = false;
  let lost = false;
  let nowMs = 0;
  const last = new Vector3();
  const delta = new Vector3();

  const finish = () => {
    isDone = true;
    for (const g of group) transitions.hold(g.id, false);
  };
  const back = () => {
    for (const g of group) {
      transitions.hint(g.id, RETURN_MS);
      transitions.hold(g.id, false);
      bi.restore(g.id);
    }
  };
  const place = () => {
    const xr = app.settings.xr.value;
    const geo = benchGeometry(xr.posture, xr.dominantHand);
    const mat = matOf(geo.work, geo.back);
    app.bench.root.updateWorldMatrix(true, false);
    app.bench.table.updateWorldMatrix(true, false);
    _M.copy(app.bench.table.matrixWorld).invert().multiply(app.bench.root.matrixWorld);
    _t.copy(last);
    _t.y = 0;
    _t.applyMatrix4(_M);
    if (!onMatRect(mat, _t.x, _t.z)) return back();
    const origin = partOrigin(app.project.doc, item.id);
    if (!origin) return back();
    const r = movePart(app.project.doc, { part: item.id, to: { x_mm: origin.x_mm + delta.x * 1000, y_mm: origin.y_mm + delta.z * 1000 } });
    for (const g of group) {
      transitions.hint(g.id, RETURN_MS);
      transitions.hold(g.id, false);
    }
    if (!r.ok) {
      for (const g of group) bi.restore(g.id);
      if (r.reason !== 'unchanged') console.warn('[iynkware] board move refused', reasonText(app.settings.lang.value, r));
      return;
    }
    app.project.apply(r.ops, { label: r.label });
    benchKit(app).feedback.play('snap', app.bench.worldOf({ kind: 'part', part: item.id }), hand);
  };

  const holder: Holder = {
    get done() {
      return isDone;
    },
    frame(_dt, tMs) {
      if (isDone) return false;
      nowMs = tMs;
      const pose = app.input.pose(hand);
      if (!pose) loss.lost(tMs, 'hold');
      else {
        if (lost) {
          finish();
          back();
          return false;
        }
        loss.found();
      }
      const step = loss.update(tMs);
      if (step === 'return') {
        finish();
        back();
        return false;
      }
      if (step !== 'tracking' || !point.now(_hold)) return true;
      last.copy(_hold);
      delta.copy(_hold).sub(point.start);
      delta.y = 0;
      for (let i = 0; i < group.length; i++) group[i]!.object.position.set(bases[i]!.x + delta.x, bases[i]!.y, bases[i]!.z + delta.z);
      return true;
    },
    end() {
      if (isDone) return;
      if (!app.input.pose(hand)) {
        lost = true;
        loss.lost(nowMs, 'hold');
        return;
      }
      place();
      finish();
    },
    cancel() {
      if (isDone) return;
      finish();
      back();
    },
  };
  return holder;
}
