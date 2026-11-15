/**
 * Moving a whole board or the breadboard on the mat (design 3.2, 3.4.9): grab its edge band (hands) or anywhere with a
 * controller grip, and it follows the hand level; the parts seated in a breadboard ride with it. Released on the mat it
 * moves in the document (`movePart`, one undo); released off the mat it stays where it was let go, dropped onto the bench top or the floor. Wires follow.
 */
import { Matrix4, Vector3 } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import { motionOf } from '../../look/runner';
import { movePart, partOrigin } from '../core/actions';
import { benchGeometry } from '../core/geometry';
import { fallEase, fallMs, restBelow } from '../core/rest';
import { benchKit } from '../core/kit';
import { createTrackingLoss } from '../core/gesture';
import type { BenchPress } from '../core/router';
import { benchInternals } from '../space';
import { binUnder, removeOnBin, showRefusal } from './bin';
import { holdPointOf } from './hand';
import type { Holder } from './carry';
import { RETURN_MS } from './carry';
import type { Transitions } from './motion';
import { matOf, onMatRect } from './place';
import { reasonText } from './strings';

const _hold = new Vector3();
const _M = new Matrix4();
const _t = new Vector3();
const _w = new Vector3();
const _c = new Vector3();
const Y_AXIS = new Vector3(0, 1, 0);

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

  let litBin = -1;
  const finish = () => {
    isDone = true;
    if (litBin >= 0) benchKit(app).bins.highlight(-1);
    for (const g of group) transitions.hold(g.id, false);
  };
  const back = () => {
    for (const g of group) {
      transitions.hint(g.id, RETURN_MS);
      transitions.hold(g.id, false);
      bi.restore(g.id);
    }
  };
  /** Let go off the mat: it stays there, dropped straight down onto the bench top or the floor; its parts ride with it. */
  const setDown = () => {
    const o = item.object;
    _w.copy(o.position);
    app.bench.root.localToWorld(_w);
    const rest = restBelow(app, _w);
    const drop = Math.max(0, _w.y - rest.y);
    _w.y = rest.y;
    const at: [number, number, number] = [_w.x, _w.y, _w.z];
    app.bench.root.worldToLocal(_w);
    for (const g of group) {
      transitions.hint(g.id, fallMs(drop), fallEase);
      transitions.hold(g.id, false);
    }
    bi.setFree(item.id, { position: _w.clone(), quaternion: o.quaternion.clone() });
    benchKit(app).feedback.play('snap', at, hand);
  };
  /** Let go over a shelf bin: the board (or the breadboard with its parts) leaves the project, in one undo; the only board stays. */
  const putBack = (bin: number) => {
    const ids = group.map((g) => g.id);
    const refused = removeOnBin(app, transitions, item.id, ids, bin, hand);
    if (refused) {
      showRefusal(app, refused, item.object.position, hand);
      back();
      return;
    }
    // whatever the document kept (a part it did not take with the breadboard) goes back where it was
    for (const g of group) if (partOrigin(app.project.doc, g.id)) bi.restore(g.id);
  };
  const place = () => {
    const over = binUnder(app, last);
    if (over >= 0) return putBack(over);
    const xr = app.settings.xr.value;
    const geo = benchGeometry(xr.posture, xr.dominantHand);
    const mat = matOf(geo.work, geo.back);
    app.bench.root.updateWorldMatrix(true, false);
    app.bench.table.updateWorldMatrix(true, false);
    _M.copy(app.bench.table.matrixWorld).invert().multiply(app.bench.root.matrixWorld);
    _t.copy(last);
    _t.y = 0;
    _t.applyMatrix4(_M);
    if (!onMatRect(mat, _t.x, _t.z)) return setDown();
    const doc = app.project.doc;
    const origin = partOrigin(doc, item.id);
    if (!origin) return back();
    // where the document would draw it, so a board picked up from the floor lands on the mat where it is let go
    const rot = doc.views.find((v) => v.kind === 'breadboard')?.placements.find((p) => p.c === item.id)?.rotation_deg ?? 0;
    const fp = item.asset.footprint;
    _c.set(-fp.x, 0, -fp.z).applyAxisAngle(Y_AXIS, (-rot * Math.PI) / 180);
    const now = item.object.position;
    bi.setFree(item.id, null, { relayout: false });
    const r = movePart(doc, { part: item.id, to: { x_mm: (now.x - _c.x) * 1000, y_mm: (now.z - _c.z) * 1000 } });
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
      const over = binUnder(app, _hold);
      if (over !== litBin) {
        litBin = over;
        benchKit(app).bins.highlight(over);
      }
      delta.copy(_hold).sub(point.start);
      for (let i = 0; i < group.length; i++) group[i]!.object.position.set(bases[i]!.x + delta.x, bases[i]!.y + delta.y, bases[i]!.z + delta.z);
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
