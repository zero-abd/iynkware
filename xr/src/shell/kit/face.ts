/**
 * A canvas face: one quad, one texture, one draw call, painted with the look kit's painters at two texels per dmm for
 * the distance it is read from (XR_DESIGN.md 9.2). Redraws only when its key changes. Fades through `setOpacity`.
 */
import { CanvasTexture, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import { makeCanvas, PX_PER_DMM } from '../../look/paint';
import { dmm } from '../../look/type';
import { uploadNow } from '../../look/upload';

export type Ctx = CanvasRenderingContext2D;

export interface Face {
  readonly mesh: Mesh;
  /** Canvas pixels per dmm at the face's reading distance (2). */
  readonly px: number;
  readonly width: number;
  readonly height: number;
  /** Repaints when `key` differs from the last one painted. */
  draw(key: string, paint: (g: Ctx, w: number, h: number) => void): void;
  setOpacity(a: number): void;
  dispose(): void;
}

/** Canvas pixels for a face `w` by `h` metres read from `distanceM`, capped at 2048 a side (XR_DESIGN.md 11.3). */
export function faceSize(w: number, h: number, distanceM: number): { cw: number; ch: number; px: number } {
  const perM = PX_PER_DMM / dmm(1, distanceM);
  const k = Math.min(1, 2048 / Math.max(w * perM, h * perM));
  return { cw: Math.max(8, Math.round(w * perM * k)), ch: Math.max(8, Math.round(h * perM * k)), px: PX_PER_DMM * k };
}

/** A face standing in its group's plane, facing +z. `hit` keeps it raycastable (the bound mesh of a control). */
export function canvasFace(w: number, h: number, distanceM: number, opts: { hit?: boolean; order?: number } = {}): Face {
  const { cw, ch, px } = faceSize(w, h, distanceM);
  const canvas = makeCanvas(cw, ch);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = new Mesh(new PlaneGeometry(w, h), mat);
  mesh.renderOrder = opts.order ?? 20;
  if (!opts.hit) mesh.raycast = () => undefined;
  let last: string | null = null;
  return {
    mesh,
    px,
    width: cw,
    height: ch,
    draw(key, paint) {
      if (key === last) return;
      const g = canvas.getContext('2d');
      if (!g) return;
      last = key;
      g.clearRect(0, 0, cw, ch);
      paint(g, cw, ch);
      tex.needsUpdate = true;
      uploadNow(tex);
    },
    setOpacity(a) {
      mat.opacity = a;
      mesh.visible = a > 0.001;
    },
    dispose() {
      tex.dispose();
      mat.dispose();
      mesh.geometry.dispose();
    },
  };
}
