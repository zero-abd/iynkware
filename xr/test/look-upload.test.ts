/**
 * Textures reach the GPU outside the multiview pass (look/upload.ts, issue #352): a callout keeps one texture across
 * `set` and remakes it only when the label outgrows its canvas, every redraw is uploaded at once, and a label's canvas
 * is capped. The canvas is a stand-in: text is half its font size wide per character.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mesh, MeshBasicMaterial, Texture } from '@iwsdk/core';
import { createCallout } from '../src/look/callout';
import { bindUploads, uploadNow } from '../src/look/upload';
import { MAX_TEXELS, textLabel } from '../src/ui/text';

function fakeCanvas() {
  const target: Record<string | symbol, unknown> = {
    font: '10px sans-serif',
    measureText(t: string) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(String(target.font))?.[1] ?? 10);
      return { width: t.length * size * 0.5 };
    },
  };
  const g = new Proxy(target, { get: (o, k) => (k in o ? o[k] : () => undefined) });
  return { width: 300, height: 150, getContext: () => g };
}

const initTexture = vi.fn<(t: Texture) => void>();
let unbind: () => void;

beforeAll(() => {
  vi.stubGlobal('document', { createElement: () => fakeCanvas() });
  unbind = bindUploads({ initTexture, compile: () => new Set() } as never);
});
afterAll(() => {
  unbind();
  vi.unstubAllGlobals();
});
beforeEach(() => initTexture.mockClear());

const mapOf = (mesh: Mesh) => (mesh.material as MeshBasicMaterial).map!;

describe('texture uploads', () => {
  it('uploads a texture that changed, and nothing without a renderer or a change', () => {
    const c = createCallout('R1', { shape: 'tag' });
    const tex = mapOf(c.group.getObjectByName('look:callout-label') as Mesh);
    expect(initTexture).toHaveBeenCalledWith(tex);
    initTexture.mockClear();
    const fresh = { version: 0 } as Texture;
    uploadNow(fresh);
    expect(initTexture).not.toHaveBeenCalled();
    unbind();
    uploadNow(tex);
    expect(initTexture).not.toHaveBeenCalled();
    unbind = bindUploads({ initTexture, compile: () => new Set() } as never);
    c.dispose();
  });

  it('keeps one callout texture across set, and remakes it only when the label outgrows the canvas', () => {
    const c = createCallout('R1', { shape: 'card' });
    const quad = c.group.getObjectByName('look:callout-label') as Mesh;
    const tex = mapOf(quad);
    let disposed = 0;
    tex.addEventListener('dispose', () => void disposed++);
    initTexture.mockClear();

    c.set('R2');
    c.set('R3');
    expect(disposed).toBe(0);
    expect(initTexture).toHaveBeenCalledTimes(2);

    c.set('A much longer sentence that needs a wider card. It wraps.');
    expect(disposed).toBe(1);
    const wide = c.width;
    const canvas = tex.image as { width: number; height: number };
    const grown = { w: canvas.width, h: canvas.height };

    c.set('R4');
    expect(disposed).toBe(1);
    expect(canvas).toMatchObject({ width: grown.w, height: grown.h });
    // the short label shows only its corner of the bigger canvas
    expect(c.width).toBeLessThan(wide);
    expect(tex.repeat.x).toBeLessThan(1);
    expect(tex.offset.y).toBeCloseTo(1 - tex.repeat.y);
    expect(mapOf(quad)).toBe(tex);
    c.dispose();
  });

  it(`caps a label's canvas at ${MAX_TEXELS} texels a side, keeping its shape`, () => {
    const l = textLabel(1.7, 0.6);
    l.set('readout');
    const canvas = mapOf(l.mesh).image as { width: number; height: number };
    expect(canvas.width).toBe(MAX_TEXELS);
    expect(canvas.height).toBe(Math.round(0.6 * (MAX_TEXELS / 1.7)));
    expect(initTexture).toHaveBeenCalledWith(mapOf(l.mesh));
    const small = textLabel(0.1, 0.03, { px: 1000 });
    expect((mapOf(small.mesh).image as { width: number }).width).toBe(100);
    l.dispose();
    small.dispose();
  });
});
