/**
 * A figure callout in 3D: an ink dot on the target, an ink leader up to a label, and the label itself, sized in dmm
 * for the distance it is read from (XR_DESIGN.md 9.2, 6.4). Short text (a name, a pin, a reading) is the figures'
 * cream tag in mono; a sentence is a paper card with wrapped body text, at most four lines, 300 dmm wide. One texture,
 * one draw for the label, one for the leader and dot.
 *
 *   const c = createCallout('Long leg to the resistor', { distance: 0.65, tone: 'info' });
 *   c.group.position.copy(targetInParent);  parent.add(c.group);   c.set('Short leg to GND');   c.dispose();
 */
import {
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Float32BufferAttribute,
  Group,
  LinearMipmapLinearFilter,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';
import type { IconName } from './icons';
import { FIGURE_ACCENT, hexNum, INK, PAPER, TAG, TONE_INK } from './palette';
import { fitLines, makeCanvas, paintIcon, paintPill, paintPlate, PX_PER_DMM, useFont } from './paint';
import { dmm, onFontsReady, TYPE } from './type';
import { uploadNow } from './upload';

export type CalloutTone = 'do' | 'pass' | 'fail' | 'warn' | 'info';

export interface CalloutOptions {
  /** Metres from the eyes it is read at; sets every size (dmm). Bench callouts default to 0.65 m. */
  distance?: number;
  tone?: CalloutTone;
  /** Leader height above the target, metres. */
  lift?: number;
  /** `tag` (short, mono, cream pill) or `card` (a sentence on paper); picked from the text when omitted. */
  shape?: 'tag' | 'card';
  /** Lean back from vertical, radians, so a label below the eyes faces them (default 0.3). */
  lean?: number;
  /** No leader and dot (a label that floats on its own). */
  bare?: boolean;
}

export interface Callout {
  readonly group: Group;
  set(text: string): void;
  /** Moves the label up its leader (metres above the target), to clear a neighbour. */
  setLift(lift: number): void;
  readonly lift: number;
  /** The label's height and width, metres. */
  readonly height: number;
  readonly width: number;
  dispose(): void;
}

/** Body text on a card at 500: Geist 400 thins out at arm's length in a headset. */
const CARD_TEXT = { ...TYPE.body, weight: 500 as const };

const ICON_OF: Record<CalloutTone, IconName | null> = { do: 'target', pass: 'checkCircle', fail: 'xCircle', warn: 'warning', info: null };
const leaderMat = new LineBasicMaterial({ color: hexNum(INK), toneMapped: false });
const dotGeo = new CircleGeometry(1, 16);
const dotMat = new MeshBasicMaterial({ color: hexNum(INK), toneMapped: false });

export function createCallout(text: string, opts: CalloutOptions = {}): Callout {
  const distance = opts.distance ?? 0.65;
  const tone = opts.tone ?? 'info';
  let lift = opts.lift ?? 0.05;
  const leader = new BufferGeometry();
  const group = new Group();
  group.name = 'look:callout';

  // leader and dot
  if (!opts.bare) {
    const dot = new Mesh(dotGeo, dotMat);
    dot.rotation.x = -Math.PI / 2;
    dot.scale.setScalar(dmm(4, distance));
    dot.position.y = 0.0008;
    group.add(dot);
    leader.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, lift, 0], 3));
    group.add(new LineSegments(leader, leaderMat));
  }

  const canvas = makeCanvas(8, 8);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  const mat = new MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
  const quad = new Mesh(new PlaneGeometry(1, 1), mat);
  quad.name = 'look:callout-label';
  const holder = new Group();
  holder.position.y = opts.bare ? 0 : lift;
  holder.rotation.x = -(opts.lean ?? 0.3);
  holder.add(quad);
  group.add(holder);

  // The label's size in canvas pixels. The canvas only grows: a GPU texture cannot change size, so growing it makes
  // a new one (uploaded at once, so no frame samples it black); a smaller label draws into the corner of the old one.
  let cw = 0;
  let ch = 0;
  const room = (w: number, h: number): CanvasRenderingContext2D => {
    if (w > canvas.width || h > canvas.height) {
      canvas.width = Math.max(canvas.width, Math.ceil(w / 64) * 64);
      canvas.height = Math.max(canvas.height, Math.ceil(h / 64) * 64);
      tex.dispose();
    }
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    return g;
  };
  const set = (t: string) => {
    const px = PX_PER_DMM * 2; // 4 texels per dmm: sharp at arm's length
    const shape = opts.shape ?? (t.length <= 22 && !/[.!?]\s/.test(t) ? 'tag' : 'card');
    const g0 = canvas.getContext('2d')!;
    const icon = ICON_OF[tone];
    if (shape === 'tag') {
      const size = TYPE.tag.size * px;
      useFont(g0, TYPE.tag, size, t);
      const textW = g0.measureText(t).width;
      const h = Math.round(size * 1.9);
      const iconW = icon ? size * 1.15 : 0;
      const w = Math.round(textW + h * 0.9 + iconW + (icon ? size * 0.3 : 0));
      const border = Math.round(2.5 * px * 0.6);
      const shadow = Math.round(3 * px);
      cw = w + shadow + border;
      ch = h + shadow + border;
      const g = room(cw, ch);
      const fill = tone === 'do' ? FIGURE_ACCENT : TAG;
      paintPill(g, 0, 0, cw, ch, { fill, border, shadow });
      let x = h * 0.45 + border / 2;
      if (icon) {
        paintIcon(g, icon, x, (h - size * 1.15) / 2 + border / 2, size * 1.15, TONE_INK[tone]);
        x += iconW + size * 0.3;
      }
      useFont(g, TYPE.tag, size, t);
      g.fillStyle = INK;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.fillText(t, x, h / 2 + border / 2);
    } else {
      const size = TYPE.body.size * px;
      const pad = 16 * px * 0.75;
      const width = 300 * px;
      const iconW = icon ? TYPE.body.size * px * 1.2 + pad * 0.5 : 0;
      const fit = fitLines(g0, t, { role: CARD_TEXT, size, minSize: Math.max(18 * px, size * 0.85), maxWidth: width - 2 * pad - iconW, maxLines: 4 });
      const border = Math.round(2.5 * px);
      const shadow = Math.round(6 * px);
      const h = Math.round(fit.lines.length * fit.lineHeight + 2 * pad);
      const longest = Math.max(...fit.lines.map((l) => g0.measureText(l).width));
      const w = Math.round(Math.min(width, longest + 2 * pad + iconW));
      cw = w + shadow + border;
      ch = h + shadow + border;
      const g = room(cw, ch);
      paintPlate(g, 0, 0, cw, ch, { fill: tone === 'do' ? TAG : PAPER, border, shadow, radius: 12 * px });
      if (icon) paintIcon(g, icon, pad, pad + (fit.lineHeight - size * 1.2) / 2, size * 1.2, TONE_INK[tone]);
      useFont(g, CARD_TEXT, fit.size, t);
      g.fillStyle = INK;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      fit.lines.forEach((line, i) => g.fillText(line, pad + iconW, pad + fit.lineHeight * (i + 0.5)));
    }
    // the label is the canvas's top-left cw by ch (a canvas texture's v runs up from the canvas's bottom row)
    tex.repeat.set(cw / canvas.width, ch / canvas.height);
    tex.offset.set(0, 1 - ch / canvas.height);
    tex.needsUpdate = true;
    uploadNow(tex);
    const metresPerPx = dmm(1, distance) / px;
    quad.scale.set(cw * metresPerPx, ch * metresPerPx, 1);
    // the label sits on its leader by its bottom edge
    quad.position.y = opts.bare ? 0 : (ch * metresPerPx) / 2;
  };
  let current = text;
  const show = (t: string) => {
    current = t;
    set(t);
  };
  show(text);
  const offFonts = onFontsReady(() => set(current));

  return {
    group,
    set: show,
    get lift() {
      return lift;
    },
    get height() {
      return quad.scale.y;
    },
    get width() {
      return quad.scale.x;
    },
    setLift(next) {
      if (opts.bare || Math.abs(next - lift) < 1e-5) return;
      lift = next;
      holder.position.y = lift;
      const a = leader.getAttribute('position') as Float32BufferAttribute;
      a.setY(1, lift);
      a.needsUpdate = true;
      leader.computeBoundingSphere();
    },
    dispose() {
      offFonts();
      tex.dispose();
      mat.dispose();
      quad.geometry.dispose();
      leader.dispose();
      group.removeFromParent();
    },
  };
}
