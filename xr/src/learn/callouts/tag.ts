/**
 * A name tag on the bench: ink text on a paper plate with an ink outline, never accent text (design 7.1, 9.3). Its
 * text is at least 18 dmm for its viewing distance: the canvas is drawn once, and the quad is scaled to the distance.
 */
import { PlaneGeometry } from '@iwsdk/core';
import type { Lang } from '../../contracts/common';
import { roundRect } from '../kit/button';
import { lineHeight } from '../kit/dmm';
import { surface, type Surface } from '../kit/surface';
import { drawFitted, fontOf, measureText } from '../kit/text';
import type { Tokens } from '../kit/tokens';

export interface Tag {
  readonly s: Surface;
  /** Size in dmm. */
  readonly w: number;
  readonly h: number;
  /** Scales the quad for a viewing distance in metres. */
  setDistance(m: number): void;
  dispose(): void;
}

const T = 3;
const PAD = 8;

export function createTag(text: string, k: Tokens, lang: Lang, opts: { maxWidthDmm?: number; maxLines?: number; textScale?: number } = {}): Tag {
  const maxW = opts.maxWidthDmm ?? 300;
  const probe = document.createElement('canvas').getContext('2d');
  const style = { role: 'label' as const, lang, pxPerDmm: T, colour: k.ink, textScale: opts.textScale, maxLines: opts.maxLines ?? 3, weight: 500 };
  const box = { x: 0, y: 0, w: maxW * T, h: 200 * T };
  const f = probe ? measureText(probe, text, box, style) : { lines: [text], size: 20 * T, truncated: false, height: 27 * T };
  let widest = 0;
  if (probe) {
    probe.font = fontOf('label', f.size, 500);
    for (const l of f.lines) widest = Math.max(widest, probe.measureText(l).width);
  }
  const lh = f.size * lineHeight(lang);
  const w = Math.min(maxW, widest / T + 2 * PAD + 4);
  const h = (f.lines.length * lh) / T + PAD * 1.5;
  const s = surface({ widthM: w / 1000, heightM: h / 1000, pxPerM: T * 1000, name: 'guide:tag' });
  s.mesh.geometry.dispose();
  s.mesh.geometry = new PlaneGeometry(1, 1);
  s.redraw(text, (g, cw, ch) => {
    const line = 2 * T * k.outline;
    roundRect(g, { x: line / 2, y: line / 2, w: cw - line, h: ch - line }, 8 * T);
    g.fillStyle = k.paper;
    g.fill();
    g.lineWidth = line;
    g.strokeStyle = k.ink;
    g.stroke();
    drawFitted(g, f, { x: PAD * T, y: 0, w: cw - 2 * PAD * T, h: ch }, { ...style, valign: 'middle', align: f.lines.length === 1 ? 'center' : 'left' });
  });
  return {
    s,
    w,
    h,
    setDistance(m) {
      s.mesh.scale.set((w * m) / 1000, (h * m) / 1000, 1);
    },
    dispose: () => s.dispose(),
  };
}
