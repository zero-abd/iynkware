/**
 * Paper plate buttons and plates for the pillar's controls, until the platform's UI kit (issue #23) and the Art lead's
 * visual direction (`xr/src/look/**`) land; anything visible moves onto those then. One quad and
 * one canvas texture per plate, so a button is one draw call: the plate, its ink outline, its label and caption are all
 * drawn into the canvas, which is redrawn only when the label or the state changes (design 9.1 to 9.4).
 *
 * Usage:
 *   const minus = plate({ w: 0.056, h: 0.04, label: '-', caption: 'Scale' });
 *   table.add(minus.mesh);
 *   const off = bindPlate(app, minus, 'scale:minus', () => app.scale.stepWorkScale(-1));
 *
 * The quad faces +Z. Hover lifts it 3 dmm towards +Z and outlines it in accent; a press sinks it and fills it accent.
 */
import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import type { InteractionEvent } from '../../contracts/input';

/** Design 9.3, bright room. */
export const TOKENS = {
  paper: '#f2efe7',
  ink: '#231e16',
  muted: '#857d6e',
  rule: '#ddd6c8',
  shadow: '#41538f',
  accent: '#e4694e',
  good: '#1f6b4a',
  bad: '#a8402b',
  warn: '#7a5a00',
  info: '#1d4fd8',
} as const;

export const FONT = 'system-ui, "Noto Sans", "Noto Sans Devanagari", "Noto Sans SC", sans-serif';

/** Metres for `dmm` angular size seen from `distanceM` (design 0). */
export const dmm = (n: number, distanceM: number): number => (n * distanceM) / 1000;

export interface PlateState {
  label: string;
  /** A smaller second line under the label (a rail caption, a value). */
  caption: string;
  /** Latched on (a toggle that is on, the current step): accent fill. */
  active: boolean;
  disabled: boolean;
  hover: boolean;
  pressed: boolean;
}

export interface Plate {
  /** Bind this mesh (`bindPlate`); it is the whole visible plate. */
  readonly mesh: Mesh;
  readonly state: Readonly<PlateState>;
  set(patch: Partial<PlateState>): void;
  dispose(): void;
}

export interface PlateOptions {
  /** Size in metres. */
  w: number;
  h: number;
  label?: string;
  caption?: string;
  /** Canvas pixels per metre (default 2400, about two texels per dmm at 0.5 m). */
  px?: number;
}

const LIFT_DMM = 3;

export function plate(opts: PlateOptions): Plate {
  const px = opts.px ?? 2400;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(32, Math.round(opts.w * px));
  canvas.height = Math.max(16, Math.round(opts.h * px));
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  // Opaque pipeline: the rounded corners are cut by alphaTest, so plates need no sorting (design 9.1).
  const mat = new MeshBasicMaterial({ map: tex, alphaTest: 0.5 });
  const mesh = new Mesh(new PlaneGeometry(opts.w, opts.h), mat);
  mesh.name = 'scale:plate';
  const state: PlateState = {
    label: opts.label ?? '',
    caption: opts.caption ?? '',
    active: false,
    disabled: false,
    hover: false,
    pressed: false,
  };
  let lastKey = '';
  let restZ = 0;
  let restSet = false;

  const draw = () => {
    const key = JSON.stringify(state);
    if (key === lastKey) return;
    lastKey = key;
    const g = canvas.getContext('2d');
    if (!g) return;
    const { width: w, height: h } = canvas;
    const line = Math.max(2, Math.round(h * 0.06));
    const r = Math.min(h * 0.22, w * 0.22);
    g.clearRect(0, 0, w, h);
    g.beginPath();
    g.roundRect(line / 2, line / 2, w - line, h - line, r);
    g.fillStyle = state.disabled ? TOKENS.rule : state.active || state.pressed ? TOKENS.accent : TOKENS.paper;
    g.fill();
    g.lineWidth = state.hover && !state.disabled ? line * 1.6 : line;
    g.strokeStyle = state.hover && !state.disabled ? TOKENS.accent : TOKENS.ink;
    if (state.hover && (state.active || state.pressed)) g.strokeStyle = TOKENS.ink;
    g.stroke();
    const fg = state.disabled ? TOKENS.muted : TOKENS.ink;
    const room = w * 0.86;
    const fit = (text: string, size: number, weight: number) => {
      g.font = `${weight} ${size}px ${FONT}`;
      const m = g.measureText(text).width;
      // Shrink to fit, but never below 85 % of the role's size (design 9.5); past that, cut with an ellipsis.
      const s = m > room ? Math.max(Math.floor((size * room) / m), Math.floor(size * 0.85)) : size;
      g.font = `${weight} ${s}px ${FONT}`;
      let t = text;
      while (t.length > 1 && g.measureText(t).width > room) t = t.slice(0, -2) + '…';
      return t;
    };
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (state.caption) {
      const label = fit(state.label, Math.round(h * 0.4), 600);
      g.fillText(label, w / 2, h * 0.38);
      const caption = fit(state.caption, Math.round(h * 0.24), 500);
      g.fillText(caption, w / 2, h * 0.75);
    } else {
      const label = fit(state.label, Math.round(h * 0.46), 600);
      g.fillText(label, w / 2, h / 2);
    }
    tex.needsUpdate = true;
  };

  const place = () => {
    if (!restSet) {
      restZ = mesh.position.z;
      restSet = true;
    }
    const lift = dmm(LIFT_DMM, 0.5);
    mesh.position.z = restZ + (state.pressed ? -lift : state.hover && !state.disabled ? lift : 0);
  };

  draw();
  return {
    mesh,
    state,
    set(patch) {
      const moving = 'hover' in patch || 'pressed' in patch;
      if (moving && !restSet) {
        restZ = mesh.position.z;
        restSet = true;
      }
      Object.assign(state, patch);
      draw();
      if (moving) place();
    },
    dispose() {
      tex.dispose();
      mat.dispose();
      mesh.geometry.dispose();
    },
  };
}

/**
 * Binds a plate for ray (controller trigger, hand pinch, mouse) and poke (fingertip), with hover and press visuals and
 * the hover and press haptics of design section 4. `onSelect` runs on a completed select while not disabled.
 */
export function bindPlate(
  app: Pick<XrApp, 'input'>,
  p: Plate,
  id: string,
  onSelect: (e: InteractionEvent) => void,
): Unsubscribe {
  return app.input.bind(p.mesh, { id, ray: true, poke: true }, (e) => {
    const hand = e.pointer.hand;
    switch (e.type) {
      case 'hover-start':
        p.set({ hover: true });
        if (hand && !p.state.disabled) app.input.pulse(hand, 0.08, 8);
        break;
      case 'hover-end':
        p.set({ hover: false, pressed: false });
        break;
      case 'select-start':
        if (!p.state.disabled) p.set({ pressed: true });
        break;
      case 'select-end':
        p.set({ pressed: false });
        break;
      case 'select':
        if (p.state.disabled) break;
        if (hand) app.input.pulse(hand, 0.35, 12);
        onSelect(e);
        break;
      default:
        break;
    }
  });
}
