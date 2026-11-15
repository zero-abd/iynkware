/**
 * A canvas-textured face: the drawable surface of a plate button, a chip, a display or a panel. The browser's own text
 * shaper draws into it, so Devanagari and Chinese render with the platform's fonts (docs/XR_ARCHITECTURE.md section 7).
 * Two texels per dmm (9.2), mipmaps on. Redraw only on change: `draw` is cheap to call with the same key.
 */
import { CanvasTexture, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import type { BufferGeometry } from '@iwsdk/core';
import type { Lang } from '../../contracts/common';
import { roundedQuad } from './ink';
import { dmm } from './tokens';
import { uploadNow } from '../../look/upload';

export const SANS = '"Geist", system-ui, "Noto Sans", "Noto Sans Devanagari", "Noto Sans SC", sans-serif';
export const MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, "Noto Sans Mono", monospace';

/** Devanagari and Chinese are set 1.15x the Latin size for the same role (9.2). */
export function scriptScale(lang: Lang): number {
  return lang === 'hi' || lang === 'zh' ? 1.15 : 1;
}

export type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

export interface Face {
  readonly mesh: Mesh;
  /** Canvas pixels per metre of the face. */
  readonly pxPerM: number;
  /** Redraws when `key` differs from the last drawn one. */
  draw(key: string, fn: Draw): void;
  dispose(): void;
}

/** A face `w` by `h` metres seen from about `distanceM`. `up` lies flat facing +y (w along x, h along z); else it faces +z. */
export function canvasFace(w: number, h: number, opts: { distanceM?: number; up?: boolean; radius?: number } = {}): Face {
  const pxPerM = 2 / dmm(1, opts.distanceM ?? 0.47);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(16, Math.min(2048, Math.round(w * pxPerM)));
  canvas.height = Math.max(16, Math.min(2048, Math.round(h * pxPerM)));
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  let geo: BufferGeometry;
  if (opts.up) geo = roundedQuad(w, h, opts.radius ?? 0);
  else geo = new PlaneGeometry(w, h);
  const mesh = new Mesh(geo, mat);
  mesh.raycast = () => undefined;
  mesh.renderOrder = 2;
  let last = '';
  return {
    mesh,
    pxPerM: canvas.width / w,
    draw(key, fn) {
      if (key === last) return;
      last = key;
      const g = canvas.getContext('2d');
      if (!g) return;
      g.clearRect(0, 0, canvas.width, canvas.height);
      fn(g, canvas.width, canvas.height);
      tex.needsUpdate = true;
      uploadNow(tex);
    },
    dispose() {
      tex.dispose();
      mat.dispose();
      geo.dispose();
    },
  };
}

/**
 * Sets `text` in one line within `maxW` pixels: as large as `size`, shrunk by up to 15 %, then cut with an ellipsis
 * (9.5). Returns the font size used. The caller sets fillStyle, textAlign and textBaseline.
 */
export function fitLine(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, font = SANS, weight = 500): number {
  let px = size;
  g.font = `${weight} ${px}px ${font}`;
  let wide = g.measureText(text).width;
  if (wide > maxW) {
    px = Math.max(size * 0.85, (size * maxW) / wide);
    g.font = `${weight} ${px}px ${font}`;
    wide = g.measureText(text).width;
  }
  let out = text;
  if (wide > maxW) {
    while (out.length > 1 && g.measureText(`${out}…`).width > maxW) out = out.slice(0, -1);
    out = `${out.trimEnd()}…`;
  }
  g.fillText(out, x, y);
  return px;
}

/** A rounded rectangle path. */
export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}
