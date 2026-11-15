/**
 * One canvas, one texture, one quad: a single draw call that is redrawn only when its content key changes (design 9.2).
 * Flat unlit colour, opaque with alpha-tested corners so nothing needs sorting (design 9.1). The quad faces +Z.
 *
 * Usage: const s = surface({ widthM: 0.52, heightM: 0.4, pxPerM: 2200 }); s.redraw(key, (g, w, h) => { ... });
 */
import { CanvasTexture, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import { uploadNow } from '../../look/upload';

export interface Surface {
  readonly mesh: Mesh;
  readonly canvas: HTMLCanvasElement;
  readonly texture: CanvasTexture;
  /** Canvas pixels per metre of the quad. */
  readonly pxPerM: number;
  /** Runs `draw` and uploads the texture when `key` differs from the last one; returns whether it drew. */
  redraw(key: string, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): boolean;
  /** Forgets the key, so the next `redraw` draws. */
  invalidate(): void;
  dispose(): void;
}

/** Textures stay at most 2048 square (design 11.3). */
export const MAX_TEXTURE_PX = 2048;

export function surface(opts: { widthM: number; heightM: number; pxPerM: number; transparent?: boolean; name?: string }): Surface {
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, MAX_TEXTURE_PX / (opts.widthM * opts.pxPerM), MAX_TEXTURE_PX / (opts.heightM * opts.pxPerM));
  const pxPerM = opts.pxPerM * scale;
  canvas.width = Math.max(8, Math.round(opts.widthM * pxPerM));
  canvas.height = Math.max(8, Math.round(opts.heightM * pxPerM));
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  const material = opts.transparent
    ? new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
    : new MeshBasicMaterial({ map: texture, alphaTest: 0.5 });
  const mesh = new Mesh(new PlaneGeometry(opts.widthM, opts.heightM), material);
  if (opts.name) mesh.name = opts.name;
  let last: string | null = null;
  return {
    mesh,
    canvas,
    texture,
    pxPerM,
    redraw(key, draw) {
      if (key === last) return false;
      const g = canvas.getContext('2d');
      if (!g) return false;
      last = key;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      draw(g, canvas.width, canvas.height);
      texture.needsUpdate = true;
      uploadNow(texture);
      return true;
    },
    invalidate() {
      last = null;
    },
    dispose() {
      texture.dispose();
      material.dispose();
      mesh.geometry.dispose();
      mesh.removeFromParent();
    },
  };
}
