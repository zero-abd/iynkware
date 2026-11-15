/**
 * Text as canvas textures: the browser's own shaper draws it, so Devanagari and Chinese render with the platform's
 * fonts. Each label is one quad, one texture, one draw call; redraw only on change. Drawn in iynk's hand by the look
 * kit (`xr/src/look/paint.ts`): an opaque paper plate with an ink outline and a flat blue shadow plate, Geist type,
 * wrapped and fitted (XR_DESIGN.md 9.5). A transparent `bg` draws the text alone, in ink.
 *
 *   const l = textLabel(0.3, 0.06, { role: 'label', maxLines: 2 });  l.set('Run');  parent.add(l.mesh);
 */
import { CanvasTexture, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import { INK, PAPER } from '../look/palette';
import { fitLines, paintPlate } from '../look/paint';
import { onFontsReady, TYPE, type TypeName } from '../look/type';
import { uploadNow } from '../look/upload';

export interface TextLabel {
  readonly mesh: Mesh;
  set(text: string, opts?: { bg?: string; fg?: string }): void;
  dispose(): void;
}

export interface TextLabelOptions {
  bg?: string;
  fg?: string;
  /** Canvas pixels per metre (2400 by default), lowered so neither side exceeds `MAX_TEXELS`. */
  px?: number;
  /** The type role (look/type.ts); `label` by default. */
  role?: TypeName;
  /** Lines the text may wrap onto before it shrinks; 1 by default. */
  maxLines?: number;
  align?: 'center' | 'left';
}

/** The longest side of a label's canvas, texels (as `run/kit/face.ts`). */
export const MAX_TEXELS = 2048;

const transparent = (c: string) => /^#[0-9a-f]{6}00$/i.test(c) || /rgba\([^)]*,\s*0\)$/.test(c) || c === 'transparent';

/** A label `widthM` metres wide; the canvas is `px` pixels per metre. Text wraps, then shrinks, never clips. */
export function textLabel(widthM: number, heightM: number, opts: TextLabelOptions = {}): TextLabel {
  // at most MAX_TEXELS on the longer side: a bigger texture costs memory and upload time, not sharpness at that size
  const px = Math.min(opts.px ?? 2400, MAX_TEXELS / Math.max(widthM, heightM));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(64, Math.round(widthM * px));
  canvas.height = Math.max(32, Math.round(heightM * px));
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  const mat = new MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
  const mesh = new Mesh(new PlaneGeometry(widthM, heightM), mat);
  const role = TYPE[opts.role ?? 'label'];
  const maxLines = Math.max(1, opts.maxLines ?? 1);
  let bg = opts.bg ?? PAPER;
  let fg = opts.fg ?? INK;
  let text = '';
  let last = '';
  const draw = (force = false) => {
    const key = `${text}|${bg}|${fg}`;
    if (key === last && !force) return;
    last = key;
    const g = canvas.getContext('2d');
    if (!g) return;
    const { width: w, height: h } = canvas;
    g.clearRect(0, 0, w, h);
    const plate = !transparent(bg);
    // the plate: outline about 2.5 dmm and the shadow plate about 6 dmm on a 40 dmm tall label
    const border = plate ? Math.max(3, Math.round(h * 0.06)) : 0;
    const shadow = plate ? Math.max(3, Math.round(h * 0.09)) : 0;
    if (plate) paintPlate(g, 0, 0, w, h, { fill: bg, border, radius: Math.min(h * 0.3, 40), shadow });
    const padX = plate ? h * 0.32 : h * 0.06;
    const innerW = w - shadow - border - 2 * padX;
    const innerH = h - shadow - border - (plate ? h * 0.16 : 0);
    const size = Math.min(innerH / (maxLines * 1.35), h * 0.52);
    const fit = fitLines(g, text, { role, size, minSize: size * 0.85, maxWidth: innerW, maxLines });
    g.fillStyle = fg;
    g.textBaseline = 'middle';
    g.textAlign = opts.align === 'left' ? 'left' : 'center';
    const x = opts.align === 'left' ? padX + border / 2 : (w - shadow) / 2;
    const top = (h - shadow) / 2 - ((fit.lines.length - 1) * fit.lineHeight) / 2;
    fit.lines.forEach((line, i) => g.fillText(line, x, top + i * fit.lineHeight));
    tex.needsUpdate = true;
    uploadNow(tex);
  };
  // text drawn before the self-hosted fonts arrive is in the system stack: draw it again in Geist
  const offFonts = onFontsReady(() => draw(true));
  return {
    mesh,
    set(next, o) {
      bg = o?.bg ?? bg;
      fg = o?.fg ?? fg;
      text = next;
      draw();
    },
    dispose() {
      offFonts();
      tex.dispose();
      mat.dispose();
      mesh.geometry.dispose();
    },
  };
}
