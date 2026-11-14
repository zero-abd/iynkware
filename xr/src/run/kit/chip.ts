/**
 * A chip: a paper plate with an ink outline and a flat `shadow` plate behind it, carrying an optional state icon and
 * one to a few lines of text (6.4 readouts `2.03 V  14.6 mA`, the clock, a meter reading, a ticker line). It faces +z;
 * call `faceViewer` from a tick to turn it towards the eyes. Redrawn only when its text changes.
 *
 *   const chip = textChip({ widthDmm: 300, lines: 2, distanceM: 0.6, mono: true });
 *   chip.set({ lines: ['2.03 V  14.6 mA'], icon: 'hot', tone: 'warn', lang });
 *
 * Adapter: the spatial UI kit (#23) owns chips and cards; switch when it lands and keep the call sites.
 */
import { Group, Quaternion, Vector3, type Camera, type Object3D } from '@iwsdk/core';
import type { Lang } from '../../contracts/common';
import { canvasFace, fitLine, MONO, roundRect, SANS, scriptScale } from './face';
import { drawIcon, type IconName } from './icons';
import { dmm, INK, TYPE, type InkToken } from './tokens';

export interface ChipContent {
  lines: readonly string[];
  lang: Lang;
  icon?: IconName | null;
  /** Colours the icon and a bar down the left edge; text stays ink (colour is never the only signal). */
  tone?: InkToken | null;
}

export interface Chip {
  readonly group: Group;
  /** Width and height in metres. */
  readonly w: number;
  readonly h: number;
  set(content: ChipContent): void;
  dispose(): void;
}

export interface ChipOptions {
  /** Width in dmm (chips are 300 to 360 dmm wide, 9.1). */
  widthDmm?: number;
  /** How many lines it has room for. */
  lines?: number;
  /** Font size in dmm. Default the label size, 20. */
  sizeDmm?: number;
  distanceM?: number;
  mono?: boolean;
}

export function textChip(opts: ChipOptions = {}): Chip {
  const dist = opts.distanceM ?? 0.6;
  const size = opts.sizeDmm ?? TYPE.label;
  const rows = Math.max(1, opts.lines ?? 1);
  const pad = 16;
  const shadowOff = 6;
  const wDmm = opts.widthDmm ?? 300;
  const hDmm = pad * 2 + rows * size * 1.45 + shadowOff;
  const w = dmm(wDmm + shadowOff, dist);
  const h = dmm(hDmm, dist);
  const group = new Group();
  const face = canvasFace(w, h, { distanceM: dist });
  group.add(face.mesh);
  let lang: Lang = 'en';
  return {
    group,
    w,
    h,
    set(c) {
      lang = c.lang;
      const key = JSON.stringify([c.lines, c.lang, c.icon ?? null, c.tone ?? null]);
      face.draw(key, (g, W, H) => {
        const u = W / (wDmm + shadowOff);
        const pw = wDmm * u;
        const ph = H - shadowOff * u;
        const r = 12 * u;
        g.fillStyle = INK.shadow;
        roundRect(g, shadowOff * u, shadowOff * u, pw, ph, r);
        g.fill();
        g.fillStyle = INK.paper;
        roundRect(g, 0, 0, pw, ph, r);
        g.fill();
        g.lineWidth = 2.5 * u;
        g.strokeStyle = INK.ink;
        roundRect(g, 1.25 * u, 1.25 * u, pw - 2.5 * u, ph - 2.5 * u, r);
        g.stroke();
        let x = pad * u;
        if (c.tone) {
          g.fillStyle = INK[c.tone];
          g.fillRect(4 * u, 8 * u, 4 * u, ph - 16 * u);
        }
        const font = size * u * scriptScale(lang);
        const lineH = font * (lang === 'hi' ? 1.55 : lang === 'zh' ? 1.45 : 1.35);
        if (c.icon) {
          const s = 24 * u;
          drawIcon(g, c.icon, x + s / 2, pad * u + lineH / 2, s, c.tone ? INK[c.tone] : INK.ink);
          x += s + 8 * u;
        }
        g.fillStyle = INK.ink;
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        c.lines.slice(0, rows).forEach((line, i) => {
          fitLine(g, line, x, pad * u + lineH * (i + 0.5), pw - x - pad * u, font, opts.mono ? MONO : SANS, i === 0 ? 600 : 500);
        });
      });
    },
    dispose() {
      face.dispose();
      group.removeFromParent();
    },
  };
}

const eye = new Vector3();
const at = new Vector3();
const parentQ = new Quaternion();
const want = new Quaternion();
const yawQ = new Quaternion();
const pitchQ = new Quaternion();
const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);

/**
 * Turns `object` (facing +z) towards the camera: yaw fully, pitch within `maxPitchRad` (6.4: 30 degrees), never
 * roll. Allocates nothing. Call from a tick.
 */
export function faceViewer(object: Object3D, camera: Camera, maxPitchRad = Math.PI / 6): void {
  camera.getWorldPosition(eye);
  object.getWorldPosition(at);
  const dx = eye.x - at.x;
  const dy = eye.y - at.y;
  const dz = eye.z - at.z;
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.max(-maxPitchRad, Math.min(maxPitchRad, Math.atan2(dy, Math.hypot(dx, dz))));
  yawQ.setFromAxisAngle(Y, yaw);
  pitchQ.setFromAxisAngle(X, -pitch);
  want.multiplyQuaternions(yawQ, pitchQ);
  if (object.parent) {
    object.parent.getWorldQuaternion(parentQ).invert();
    want.premultiply(parentQ);
  }
  object.quaternion.copy(want);
}
