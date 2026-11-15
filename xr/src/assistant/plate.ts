/**
 * The assistant's buttons: look-kit pills (paper, ink outline, flat blue shadow; the accent for the primary one) with
 * an icon and a label, one quad and one canvas each, redrawn only when what they show changes. Bound for ray (trigger,
 * pinch, mouse) and poke (fingertip), so hands and controllers both work; hover lifts the pill and a press sinks it
 * (look/moves.ts), with the hover and press haptics of the design's input section.
 */
import { CanvasTexture, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';
import type { XrApp } from '../contracts/app';
import type { Unsubscribe } from '../contracts/common';
import { hoverLift, pressTravel } from '../look/moves';
import { ACCENT, INK, MUTED, PAPER, RULE } from '../look/palette';
import { fitLines, makeCanvas, paintIcon, paintPill } from '../look/paint';
import type { IconName } from '../look/icons';
import { TYPE } from '../look/type';
import { uploadNow } from '../look/upload';

export interface PlateLook {
  label: string;
  icon?: IconName;
  enabled: boolean;
  primary?: boolean;
  /** Latched on (accept-all while it runs). */
  active?: boolean;
}

export interface Plate {
  readonly mesh: Mesh;
  set(look: PlateLook): void;
  /** Draws again (the fonts arrived). */
  refresh(): void;
  dispose(): void;
}

/** Texels per metre: 4 per dmm read from 0.55 m, sharp at arm's length. */
const PX_PER_M = 4 / (0.55 / 1000);

export function createPlate(app: Pick<XrApp, 'world' | 'input'>, id: string, size: { w: number; h: number }, onSelect: () => void): Plate & { bind(): Unsubscribe } {
  const canvas = makeCanvas(size.w * PX_PER_M, size.h * PX_PER_M);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  // Opaque with the corners cut by alphaTest: no sorting against the bench.
  const mat = new MeshBasicMaterial({ map: tex, alphaTest: 0.5, toneMapped: false });
  const mesh = new Mesh(new PlaneGeometry(size.w, size.h), mat);
  mesh.name = `assistant:${id}`;
  let look: PlateLook = { label: '', enabled: false };
  let hover = false;
  let pressed = false;
  let drawnKey = '';

  const draw = () => {
    const key = JSON.stringify([look, hover, pressed]);
    if (key === drawnKey) return;
    drawnKey = key;
    const g = canvas.getContext('2d');
    if (!g) return;
    const { width: w, height: h } = canvas;
    g.clearRect(0, 0, w, h);
    const border = Math.max(3, Math.round(h * 0.055));
    const shadow = Math.round(h * 0.09);
    const lit = look.enabled && (look.primary || look.active || pressed);
    paintPill(g, 0, 0, w, h, {
      fill: !look.enabled ? RULE : lit ? ACCENT : PAPER,
      ink: hover && look.enabled && !lit ? ACCENT : INK,
      border: hover && look.enabled ? border * 1.5 : border,
      shadow: look.enabled ? shadow : 0,
    });
    const fg = look.enabled ? INK : MUTED;
    const inner = h - shadow;
    const iconSize = look.icon ? inner * 0.46 : 0;
    const gap = look.icon ? inner * 0.16 : 0;
    const room = w - shadow - inner * 0.8 - iconSize - gap;
    const fit = fitLines(g, look.label, { role: TYPE.label, size: inner * 0.36, maxWidth: room, maxLines: 1 });
    const text = fit.lines[0] ?? '';
    const textW = g.measureText(text).width;
    const x0 = (w - shadow - (iconSize + gap + textW)) / 2;
    if (look.icon) paintIcon(g, look.icon, x0, (inner - iconSize) / 2, iconSize, fg);
    g.fillStyle = fg;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText(text, x0 + iconSize + gap, inner / 2 + border * 0.2);
    tex.needsUpdate = true;
    uploadNow(tex);
  };

  return {
    mesh,
    set(next) {
      look = next;
      draw();
    },
    bind() {
      return app.input.bind(mesh, { id: `assistant:${id}`, ray: true, poke: true }, (e) => {
        const hand = e.pointer.hand;
        switch (e.type) {
          case 'hover-start':
            hover = true;
            draw();
            hoverLift(app.world, mesh, 0.0016, true);
            if (hand && look.enabled) app.input.pulse(hand, 0.08, 8);
            break;
          case 'hover-end':
            hover = false;
            pressed = false;
            draw();
            hoverLift(app.world, mesh, 0.0016, false);
            break;
          case 'select-start':
            if (!look.enabled) break;
            pressed = true;
            draw();
            pressTravel(app.world, mesh, 0.0016, true, 'z');
            break;
          case 'select-end':
            pressed = false;
            draw();
            pressTravel(app.world, mesh, 0.0016, false, 'z');
            break;
          case 'select':
            if (!look.enabled || !mesh.visible) break;
            if (hand) app.input.pulse(hand, 0.35, 12);
            onSelect();
            break;
          default:
            break;
        }
      });
    },
    refresh() {
      drawnKey = '';
      draw();
    },
    dispose() {
      tex.dispose();
      mat.dispose();
      mesh.geometry.dispose();
    },
  };
}
