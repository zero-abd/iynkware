/**
 * The multimeter's body: an inked wedge (120 x 200 mm, 20 degrees, the face turned to the person) on the rack, with
 * its display, the four mode plates and the Put back plate on the slope, and two jacks at the back for the leads.
 * Draws only; `index.ts` decides what the display shows.
 */
import { ExtrudeGeometry, Group, Shape, Vector3 } from '@iwsdk/core';
import type { XrApp } from '../../../contracts/app';
import type { Lang } from '../../../contracts/common';
import { FIGURE_ACCENT, INK, PAPER } from '../../../look/palette';
import { canvasFace, fitLine, inkShadow, inkSolid, MONO, plateButton, roundRect, SANS, scriptScale, TYPE, dmm, type Plate, type RunLayout } from '../../kit';
import { MODES, type MeterMode, type Shown } from './logic';
import { meterStrings as S, type MeterStringKey } from './strings';

export const BODY_W = 0.12;
export const BODY_D = 0.2;
const TILT = (20 * Math.PI) / 180;
const H_FRONT = 0.012;
const H_BACK = H_FRONT + BODY_D * Math.tan(TILT);
const VIEW_M = 0.5;

const MODE_LABEL: Readonly<Record<MeterMode, { text: MeterStringKey; long: MeterStringKey }>> = {
  'dc-volts': { text: 'volts', long: 'dcVolts' },
  'dc-amps': { text: 'amps', long: 'dcAmps' },
  resistance: { text: 'ohms', long: 'resistance' },
  continuity: { text: 'beep', long: 'continuity' },
};

/** Plates on the slope: `x` along the body, `z` down the slope towards the person. */
const SPOTS: Readonly<Record<MeterMode, { x: number; z: number }>> = {
  'dc-volts': { x: -0.029, z: -0.012 },
  'dc-amps': { x: 0.029, z: -0.012 },
  resistance: { x: -0.029, z: 0.028 },
  continuity: { x: 0.029, z: 0.028 },
};

export interface MeterBody {
  readonly group: Group;
  readonly plates: Readonly<Record<MeterMode, Plate>> & { readonly back: Plate };
  /** The display's content. Redraws only when it differs from the last. */
  show(content: DisplayContent): void;
  /** Table-frame position of the jack of a lead (`-1` red side, `+1` black side). */
  jackOf(side: -1 | 1, out: Vector3): Vector3;
  /** Puts the body in its slot. */
  place(layout: RunLayout): void;
  setLang(lang: Lang): void;
  dispose(): void;
}

export interface DisplayContent {
  readonly mode: MeterMode;
  readonly shown: Shown;
  readonly lang: Lang;
}

/** A plate on the body casts no flat shadow on the mat (one draw call fewer each); its own outline and lift stay. */
function unshadow(plate: Plate): void {
  for (const child of [...plate.group.children]) if ((child as { isMesh?: boolean }).isMesh) plate.group.remove(child);
}

/** The wedge: front edge `H_FRONT` high, back edge `H_BACK`. Centred on x and z, base at y = 0. */
function wedge(): ExtrudeGeometry {
  const s = new Shape();
  s.moveTo(0, 0);
  s.lineTo(BODY_D, 0);
  s.lineTo(BODY_D, H_FRONT);
  s.lineTo(0, H_BACK);
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth: BODY_W, bevelEnabled: false, curveSegments: 1 });
  g.rotateY(-Math.PI / 2);
  g.translate(BODY_W / 2, 0, -BODY_D / 2);
  return g;
}

export function createMeterBody(app: XrApp, lang: Lang): MeterBody {
  const group = new Group();
  group.name = 'run-meter';
  const solid = inkSolid(wedge(), FIGURE_ACCENT);
  group.add(solid.group);
  const shadow = inkShadow(BODY_W + 0.004, BODY_D + 0.004, 0.012);
  shadow.raycast = () => undefined;
  group.add(shadow);

  // The slope: its origin is the middle of the sloping face, its +y the face's normal.
  const slope = new Group();
  slope.position.set(0, (H_FRONT + H_BACK) / 2 + 0.0004, 0);
  slope.rotation.x = TILT;
  group.add(slope);

  const display = canvasFace(0.104, 0.05, { distanceM: VIEW_M, up: true, radius: 0.004 });
  display.mesh.position.set(0, 0.0006, -0.075);
  slope.add(display.mesh);

  const size = { w: 0.052, d: 0.036, h: 0.006, distanceM: VIEW_M };
  const plates = {} as Record<MeterMode, Plate> & { back: Plate };
  for (const mode of MODES) {
    const plate = plateButton(app, size, { icon: null, label: S.t(lang, MODE_LABEL[mode].text), lang });
    plate.group.position.set(SPOTS[mode].x, 0.0004, SPOTS[mode].z);
    plate.hit.name = `run:meter:${mode}`;
    unshadow(plate);
    slope.add(plate.group);
    plates[mode] = plate;
  }
  plates.back = plateButton(app, { w: 0.106, d: 0.03, h: 0.006, distanceM: VIEW_M }, { icon: 'probe', label: S.t(lang, 'putBack'), lang });
  plates.back.group.position.set(0, 0.0004, 0.07);
  plates.back.hit.name = 'run:meter:back';
  unshadow(plates.back);
  slope.add(plates.back.group);

  let current: DisplayContent | null = null;

  const api: MeterBody = {
    group,
    plates,
    show(c) {
      current = c;
      const { shown, mode } = c;
      const word =
        shown.closed === null ? '' : shown.closed ? S.t(c.lang, 'closed') : S.t(c.lang, 'open');
      const digits = shown.closed === null ? shown.text : word;
      const note = shown.reason !== null ? S.t(c.lang, shown.reason) : '';
      const key = JSON.stringify([mode, digits, shown.unit, note, c.lang]);
      display.draw(key, (g, w, h) => {
        const px = display.pxPerM;
        g.fillStyle = PAPER;
        roundRect(g, 0, 0, w, h, 0.004 * px);
        g.fill();
        g.lineWidth = dmm(2.5, VIEW_M) * px;
        g.strokeStyle = INK;
        roundRect(g, g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth, 0.004 * px);
        g.stroke();
        g.textBaseline = 'middle';
        // The mode, small, top left; the note (why `--`) top right.
        const small = dmm(TYPE.caption, VIEW_M) * px * scriptScale(c.lang);
        g.fillStyle = INK;
        g.textAlign = 'left';
        fitLine(g, S.t(c.lang, MODE_LABEL[mode].long), w * 0.04, h * 0.17, w * (note ? 0.42 : 0.9), small, SANS, 600);
        if (note) {
          g.textAlign = 'right';
          fitLine(g, note, w * 0.96, h * 0.17, w * 0.5, small, SANS, 500);
        }
        // The digits: mono, as large as fits beside the unit.
        const big = dmm(TYPE.display, VIEW_M) * px;
        const unitSize = big * 0.55;
        g.textAlign = 'left';
        g.font = `600 ${unitSize}px ${SANS}`;
        const unitW = shown.unit ? g.measureText(shown.unit).width + big * 0.15 : 0;
        const room = w * 0.94 - unitW;
        let fontPx = big;
        g.font = `600 ${fontPx}px ${MONO}`;
        const wide = g.measureText(digits).width;
        if (wide > room) fontPx = (fontPx * room) / wide;
        g.font = `600 ${fontPx}px ${MONO}`;
        const dw = g.measureText(digits).width;
        const left = w * 0.03 + Math.max(0, room - dw);
        g.textAlign = 'left';
        g.fillStyle = shown.reason !== null ? '#857d6e' : INK;
        g.fillText(digits, left, h * 0.62);
        if (shown.unit) {
          g.font = `600 ${unitSize}px ${SANS}`;
          g.fillStyle = INK;
          g.fillText(shown.unit, left + dw + big * 0.15, h * 0.66);
        }
      });
    },
    jackOf(side, out) {
      return out.set(group.position.x + side * 0.03, H_BACK * 0.55, group.position.z - BODY_D / 2);
    },
    place(layout) {
      const p = layout.meter.position;
      group.position.set(p[0], 0, p[2]);
    },
    setLang(next) {
      for (const mode of MODES) plates[mode].set({ label: S.t(next, MODE_LABEL[mode].text), lang: next });
      plates.back.set({ label: S.t(next, 'putBack'), lang: next });
      if (current) api.show({ ...current, lang: next });
    },
    dispose() {
      for (const mode of MODES) plates[mode].dispose();
      plates.back.dispose();
      display.dispose();
      solid.dispose();
      shadow.geometry.dispose();
      group.removeFromParent();
    },
  };
  return api;
}
