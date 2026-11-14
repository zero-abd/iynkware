/**
 * The display view: a one-bit panel (an OLED) drawn as a texture laid on the part's `screen:` anchor rectangle, in the
 * part object's frame. The state's `rows` are the framebuffer, one hex string a row, four pixels a digit, the left
 * pixel the high bit. Light ink on near-black, nearest filtering so each pixel stays a crisp square, one draw call.
 * Redrawn only when the picture changes and at most ten times a second. A part with no screen anchor gets the panel on
 * the top face of its body.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  MeshBasicMaterial,
  Mesh,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from '@iwsdk/core';
import type { Anchor, XrAsset } from '../../contracts/assets';
import type { PartState, PartView, PartViewFactory } from '../../contracts/part-view';
import { INK, PAPER, hexNum } from '../../look/palette';

/** The shortest time between two redraws, milliseconds (at most 10 Hz). */
export const REDRAW_MS = 100;
/** The lift off the surface, so the panel never fights the body's top face for the depth buffer, metres. */
const LIFT = 0.0002;

const rgbOf = (hex: string): [number, number, number] => {
  const n = hexNum(hex);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const LIT = rgbOf(PAPER);
const DARK = rgbOf(INK);

/** Whether pixel (x, y) is set: row `y` is a hex string, digit `x >> 2` holds four pixels, the left one the high bit. */
export function pixelSet(rows: readonly string[], x: number, y: number): boolean {
  const digit = rows[y]?.charCodeAt(x >> 2);
  if (digit === undefined) return false;
  // '0'..'9' is 48..57, 'a'..'f' 97..102, 'A'..'F' 65..70
  const v = digit <= 57 ? digit - 48 : digit >= 97 ? digit - 87 : digit - 55;
  return v >= 0 && v <= 15 && ((v >> (3 - (x & 3))) & 1) === 1;
}

/** Writes the picture into `out` (RGBA, w x h, row 0 first): lit pixels in `LIT`, the rest `DARK`; off is all dark. */
export function paintRows(out: Uint8Array, w: number, h: number, state: { on: boolean; inverted: boolean; rows: readonly string[] }): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const lit = state.on && pixelSet(state.rows, x, y) !== state.inverted;
      const c = lit ? LIT : DARK;
      const i = (y * w + x) * 4;
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
      out[i + 3] = 255;
    }
  }
}

/** Where the panel lies in the object frame: its top-left corner, the vectors along its width and down its height. */
export interface ScreenRect {
  origin: [number, number, number];
  u: [number, number, number];
  v: [number, number, number];
  pixels: [number, number];
}

/**
 * The panel's rectangle: the sidecar's `screen` anchor when it has one, else the top face of the body bounds, as large
 * as keeps the panel's aspect, centred.
 */
export function screenRect(anchors: readonly Anchor[], bounds: XrAsset['bounds'], pixels: readonly [number, number] = [128, 64]): ScreenRect {
  const anchor = anchors.find((a) => a.kind === 'screen' && a.rect);
  if (anchor?.rect) {
    const { origin, u, v, pixels: px } = anchor.rect;
    return { origin: [...origin], u: [...u], v: [...v], pixels: [px[0], px[1]] };
  }
  const bw = bounds.max[0] - bounds.min[0];
  const bd = bounds.max[2] - bounds.min[2];
  const aspect = pixels[0] / pixels[1];
  const width = Math.min(bw, bd * aspect);
  const height = width / aspect;
  const x0 = (bounds.min[0] + bounds.max[0]) / 2 - width / 2;
  const z0 = (bounds.min[2] + bounds.max[2]) / 2 - height / 2;
  return { origin: [x0, bounds.max[1], z0], u: [width, 0, 0], v: [0, 0, height], pixels: [pixels[0], pixels[1]] };
}

/** A quad over the rect, facing the way `v x u` points (up for a panel lying flat), uv row 0 at the origin. */
function quadOf(rect: ScreenRect): BufferGeometry {
  const { origin: o, u, v } = rect;
  const at = (a: number, b: number): [number, number, number] => [o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b, o[2] + u[2] * a + v[2] * b];
  const corners = [at(0, 0), at(1, 0), at(0, 1), at(1, 1)];
  const positions = new Float32Array(corners.flat());
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  // the quad's normal is v x u; up for u along +x and v along +z
  const nx = v[1] * u[2] - v[2] * u[1];
  const ny = v[2] * u[0] - v[0] * u[2];
  const nz = v[0] * u[1] - v[1] * u[0];
  const len = Math.hypot(nx, ny, nz) || 1;
  const n = [nx / len, ny / len, nz / len];
  g.setAttribute('normal', new BufferAttribute(new Float32Array([...n, ...n, ...n, ...n]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
  // corners: 0 origin, 1 +u, 2 +v, 3 +u+v. (0, 2, 1) and (1, 2, 3) wind towards v x u.
  g.setIndex([0, 2, 1, 1, 2, 3]);
  // lift along the normal
  const pos = g.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < 4; i++) pos.setXYZ(i, pos.getX(i) + n[0]! * LIFT, pos.getY(i) + n[1]! * LIFT, pos.getZ(i) + n[2]! * LIFT);
  g.computeBoundingSphere();
  return g;
}

export const displayView: PartViewFactory = (ctx): PartView => {
  const sidecar = ctx.asset.sidecar;
  const rect = screenRect(sidecar.anchors, sidecar.bounds);
  const [pw, ph] = rect.pixels;
  const data = new Uint8Array(pw * ph * 4);
  const texture = new DataTexture(data, pw, ph, RGBAFormat, UnsignedByteType);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = SRGBColorSpace;
  const material = new MeshBasicMaterial({ map: texture, toneMapped: false });
  const geometry = quadOf(rect);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'screen';
  mesh.raycast = () => undefined;
  ctx.object.add(mesh);

  let latest: Extract<PartState, { kind: 'display' }> | undefined;
  let drawnKey = '';
  let wantKey = '';
  let drawnAt = -Infinity;
  const draw = (now: number) => {
    paintRows(data, pw, ph, latest ?? { on: false, inverted: false, rows: [] });
    texture.needsUpdate = true;
    drawnKey = wantKey;
    drawnAt = now;
  };
  draw(0);
  drawnAt = -Infinity;
  const flush = (now: number) => {
    if (wantKey !== drawnKey && now - drawnAt >= REDRAW_MS) draw(now);
  };
  return {
    partId: ctx.partId,
    update(state: PartState) {
      if (state.kind !== 'display') return;
      latest = state;
      wantKey = `${state.on ? 1 : 0}${state.inverted ? 1 : 0}${state.rows.join('')}`;
      flush(performance.now());
    },
    // The trailing redraw of a change that came inside the last tenth of a second.
    tick: () => flush(performance.now()),
    reset() {
      latest = undefined;
      wantKey = 'off';
      draw(performance.now());
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
};
