/**
 * Text as canvas textures: the browser's own shaper draws it, so Devanagari and Chinese render with the platform's
 * fonts and no font file is bundled. Each label is one quad, one texture, one draw call; redraw only on change.
 */
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';

export interface TextLabel {
  readonly mesh: Mesh;
  set(text: string, opts?: { bg?: string; fg?: string }): void;
  dispose(): void;
}

const FONT = 'system-ui, "Noto Sans", "Noto Sans Devanagari", "Noto Sans SC", sans-serif';

/** A label `widthM` metres wide; the canvas is `px` pixels per metre. Text shrinks to fit, never clips. */
export function textLabel(widthM: number, heightM: number, opts: { bg?: string; fg?: string; px?: number } = {}): TextLabel {
  const px = opts.px ?? 1600;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(64, Math.round(widthM * px));
  canvas.height = Math.max(32, Math.round(heightM * px));
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  const mat = new MeshBasicMaterial({ map: tex, transparent: true });
  const mesh = new Mesh(new PlaneGeometry(widthM, heightM), mat);
  let bg = opts.bg ?? '#f2efe7';
  let fg = opts.fg ?? '#231e16';
  let last = '';
  const set = (text: string, o?: { bg?: string; fg?: string }) => {
    bg = o?.bg ?? bg;
    fg = o?.fg ?? fg;
    const key = `${text}|${bg}|${fg}`;
    if (key === last) return;
    last = key;
    const g = canvas.getContext('2d');
    if (!g) return;
    const { width: w, height: h } = canvas;
    g.clearRect(0, 0, w, h);
    g.fillStyle = bg;
    const r = h * 0.18;
    g.beginPath();
    g.roundRect(0, 0, w, h, r);
    g.fill();
    let size = Math.round(h * 0.5);
    g.font = `600 ${size}px ${FONT}`;
    const room = w * 0.92;
    const measured = g.measureText(text).width;
    if (measured > room) size = Math.max(8, Math.floor((size * room) / measured));
    g.font = `600 ${size}px ${FONT}`;
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2);
    tex.needsUpdate = true;
  };
  return {
    mesh,
    set,
    dispose() {
      tex.dispose();
      mat.dispose();
      mesh.geometry.dispose();
    },
  };
}
