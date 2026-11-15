/**
 * The inspector card (design 6.4, 9.1): an inked paper slab with a flat shadow plate and one canvas face, a Close plate
 * and a thin ink leader to the part. The card is built for 0.6 m; `place` scales it so its angular size holds from 0.4
 * to 2.0 m, turns it to the viewer (yaw, pitch within 30 degrees) and puts it up and towards the viewer from the part
 * so it never covers it. `draw` repaints the face and rebuilds the slab only when the model or the height changes.
 * `place` allocates nothing.
 */
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3, type Camera, type Object3D } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Lang, Unsubscribe } from '../../contracts/common';
import type { InteractionEvent } from '../../contracts/input';
import { fitLines, paintText } from '../../look/paint';
import { INK, MUTED, PAPER, RULE } from '../../look/palette';
import { dmm, TYPE, type TypeRole } from '../../look/type';
import { movable } from '../../ui/panels';
import { faceViewer } from '../../run/kit/chip';
import { bindPlate, scalePlate, type Plate } from '../kit/plate';
import { tr } from '../kit/text';
import { canvasFace, inkShadow, inkSolid, roundedSlab, type Face } from '../kit/ui';
import { CARD, layoutCard, modelKey, type CardLayout, type CardModel } from './rows';
import { PROBE } from './strings';

const D = CARD.distance;
const THICK = 0.008;

/** Nearest and farthest the card is scaled for; beyond them it just shrinks or grows with the view. */
export const NEAR_M = 0.4;
export const FAR_M = 2.0;

/** The scale that keeps the card's angular size: 1 at its design distance, distance / design inside 0.4 to 2.0 m. */
export function angularScale(distanceM: number): number {
  return Math.min(FAR_M, Math.max(NEAR_M, distanceM)) / D;
}

export interface Card {
  readonly group: Group;
  /** The leader line, in world space: add it next to `group` (not inside it). */
  readonly leader: Mesh;
  /** Repaints for `model` (a no-op while it is unchanged). */
  draw(model: CardModel, lang: Lang): void;
  /** Puts the card near `anchor` (world, metres), facing the camera, and the leader from it to `anchor`. */
  place(anchor: Vector3, camera: Camera): void;
  show(on: boolean): void;
  dispose(): void;
}

interface Slab {
  w: number;
  h: number;
  face: Face;
  dispose(): void;
}

const eye = new Vector3();
const away = new Vector3();
const mid = new Vector3();
const foot = new Vector3();
const UP = new Vector3(0, 1, 0);

export function createCard(app: XrApp, onClose: (e: InteractionEvent) => void): Card {
  const group = new Group();
  group.name = 'scale:probe:card';
  group.visible = false;
  const standing = new Group();
  standing.rotation.x = Math.PI / 2;
  group.add(standing);

  const leaderMat = new MeshBasicMaterial({ color: INK });
  const leader = new Mesh(new BoxGeometry(1, 1, 1), leaderMat);
  leader.name = 'scale:probe:leader';
  leader.raycast = () => undefined;
  leader.visible = false;

  const close: Plate = scalePlate(app, { w: dmm(CARD.close, D), d: dmm(CARD.close, D), distanceM: D, standing: true }, { icon: 'close', label: '' });
  group.add(close.group);
  const unbind: Unsubscribe = bindPlate(app, close, 'scale/probe/close', onClose);

  // The shared grip bar under the card moves it (ui/panels); once moved, the leader runs from where it was put.
  const grip = movable(app, { id: 'scale/inspector', group, width: dmm(CARD.w, D), height: dmm(CARD.w, D) * 0.6, distanceM: D, z: THICK + 0.002 });
  const placed = new Vector3();

  let slab: Slab | null = null;
  let drawn = '';
  let layout: CardLayout | null = null;
  let halfH = 0;

  const build = (hDmm: number) => {
    slab?.dispose();
    const w = dmm(CARD.w, D);
    const h = dmm(hDmm, D);
    const r = dmm(CARD.radius, D);
    const body = inkSolid(roundedSlab(w, h, THICK, r), PAPER);
    body.body.raycast = () => undefined;
    body.outline.raycast = () => undefined;
    const shadow = inkShadow(w, h, r);
    shadow.raycast = () => undefined;
    shadow.position.set(dmm(6, D), -0.005, dmm(6, D));
    const face = canvasFace(w, h, { distanceM: D, up: true, radius: r });
    face.mesh.position.set(0, THICK + 0.0003, 0);
    standing.add(body.group, shadow, face.mesh);
    slab = {
      w,
      h,
      face,
      dispose() {
        body.dispose();
        shadow.geometry.dispose();
        face.dispose();
        body.group.removeFromParent();
        shadow.removeFromParent();
        face.mesh.removeFromParent();
      },
    };
    halfH = h / 2;
    grip.resize(w, h);
    // Close sits at the top right, its 48 dmm hit inside the padding.
    close.group.position.set(w / 2 - dmm(CARD.pad + CARD.close / 2, D), h / 2 - dmm(CARD.pad + CARD.close / 2, D), THICK);
    drawn = '';
  };

  const paint = (model: CardModel, lang: Lang, lay: CardLayout, s: Slab) => {
    const key = modelKey(lang, model);
    s.face.draw(key, (g, W) => {
      const u = W / CARD.w; // canvas px per dmm
      const pad = CARD.pad * u;
      const inner = (CARD.w - CARD.pad * 2) * u;
      const text = (str: string, x: number, yDmm: number, role: TypeRole, width: number, colour: string, align: CanvasTextAlign) => {
        const f = fitLines(g, str, { role, size: role.size * u, minSize: 18 * u * 0.85, maxWidth: width, maxLines: 1 });
        g.fillStyle = colour;
        g.textAlign = align;
        g.textBaseline = 'middle';
        g.fillText(f.lines[0] ?? '', align === 'right' ? x + width : x, yDmm * u);
      };
      const titleW = (CARD.w - CARD.pad * 2 - CARD.close - 8) * u;
      text(model.title, pad, CARD.pad + CARD.head / 2, TYPE.title, titleW, INK, 'left');
      text(model.subtitle, pad, CARD.pad + CARD.head + CARD.sub / 2 - 4, TYPE.code, inner, MUTED, 'left');

      const heading = (label: string, topDmm: number) => {
        // Letter spacing and capitals break Devanagari and Chinese shaping: those languages set the heading plainly.
        const role = lang === 'hi' || lang === 'zh' ? { size: TYPE.kicker.size, weight: TYPE.kicker.weight, mono: false } : TYPE.kicker;
        paintText(g, label, pad, (topDmm + CARD.gap + CARD.heading / 2) * u, role, role.size * u, MUTED, 'left');
        g.fillStyle = RULE;
        g.fillRect(pad, (topDmm + CARD.gap + CARD.heading) * u - 1, inner, Math.max(1, u));
      };
      const rowY = (topDmm: number, i: number) => topDmm + CARD.gap + CARD.heading + i * CARD.row + CARD.row / 2;

      if (model.pins.length > 0) {
        heading(tr(PROBE, lang, 'pins'), lay.pinsTop);
        model.pins.forEach((p, i) => {
          const y = rowY(lay.pinsTop, i);
          text(p.role, pad, y, TYPE.label, inner * 0.38, INK, 'left');
          text(p.volts, pad + inner * 0.41, y, TYPE.code, inner * 0.28, INK, 'right');
          text(p.amps, pad + inner * 0.71, y, TYPE.code, inner * 0.29, INK, 'right');
        });
        if (model.pinsMore) text(model.pinsMore, pad, rowY(lay.pinsTop, model.pins.length), TYPE.label, inner, MUTED, 'left');
      }
      if (model.ratings.length > 0) {
        heading(tr(PROBE, lang, 'ratings'), lay.ratingsTop);
        model.ratings.forEach((r, i) => {
          const y = rowY(lay.ratingsTop, i);
          text(r.label, pad, y, TYPE.label, inner * 0.66, INK, 'left');
          text(r.value, pad + inner * 0.68, y, TYPE.code, inner * 0.32, INK, 'right');
        });
        if (model.ratingsMore) text(model.ratingsMore, pad, rowY(lay.ratingsTop, model.ratings.length), TYPE.label, inner, MUTED, 'left');
      }
      if (model.live.length > 0 || model.idle) {
        heading(tr(PROBE, lang, 'live'), lay.liveTop);
        model.live.forEach((r, i) => {
          const y = rowY(lay.liveTop, i);
          text(r.label, pad, y, TYPE.label, inner * 0.55, INK, 'left');
          if (r.value) text(r.value, pad + inner * 0.58, y, TYPE.code, inner * 0.42, INK, 'right');
        });
        if (model.idle) text(model.idle, pad, rowY(lay.liveTop, model.live.length), TYPE.label, inner, MUTED, 'left');
      }
    });
  };

  return {
    group,
    leader,
    draw(model, lang) {
      const lay = layoutCard(model);
      if (!slab || !layout || Math.abs(layout.h - lay.h) > 0.01) build(lay.h);
      layout = lay;
      if (slab) paint(model, lang, lay, slab);
    },
    place(anchor, camera) {
      if (!slab) return;
      camera.getWorldPosition(eye);
      const d = eye.distanceTo(anchor);
      const s = angularScale(d);
      group.scale.setScalar(s);
      // Up and towards the viewer: clear of the part, so the card never covers it.
      away.set(eye.x - anchor.x, 0, eye.z - anchor.z);
      if (away.lengthSq() < 1e-6) away.set(0, 0, 1);
      else away.normalize();
      const up = halfH * s + 0.045 * s;
      group.position.set(anchor.x + away.x * 0.03 * s, anchor.y + up, anchor.z + away.z * 0.03 * s);
      if (grip.placed(placed)) group.position.copy(placed);
      faceViewer(group, camera);
      // The leader runs from the card's lower edge to the part.
      foot.set(group.position.x, group.position.y - halfH * s, group.position.z);
      const len = foot.distanceTo(anchor);
      mid.addVectors(foot, anchor).multiplyScalar(0.5);
      leader.position.copy(mid);
      leader.up.copy(UP);
      leader.lookAt(anchor);
      leader.scale.set(0.0012, 0.0012, Math.max(1e-4, len));
      leader.visible = len > 0.004;
    },
    show(on) {
      group.visible = on;
      if (!on) leader.visible = false;
    },
    dispose() {
      group.visible = false;
      grip.dispose();
      unbind();
      close.dispose();
      slab?.dispose();
      slab = null;
      leader.geometry.dispose();
      leaderMat.dispose();
      group.removeFromParent();
      leader.removeFromParent();
    },
  };
}

/** Where the part sits in the world through `stage` (a board-frame position mapped by the stage root's matrix). */
export function stagePoint(out: Vector3, board: Vector3, stage: Object3D): Vector3 {
  stage.updateWorldMatrix(true, false);
  return out.copy(board).applyMatrix4(stage.matrixWorld);
}
