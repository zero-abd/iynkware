/**
 * The lab's panel kit: one canvas on one quad (a single draw call, redrawn only when its key changes), painted with the
 * look kit (paper plate, ink outline, flat shadow, Geist), and invisible hit boxes over the buttons drawn in it, bound
 * through `app.input.bind` for ray and poke. A button lifts to accent while hovered (the key includes the hover).
 *
 *   const p = createLabPanel(app, { id: 'lab', widthM: 0.44, heightM: 0.36, distanceM: 0.8 });
 *   p.draw(key, (g, ui) => { ui.button('go', x, y, w, h, 'Go', () => go()); ... });
 */
import { CanvasTexture, Group, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, type Object3D } from '@iwsdk/core';
import type { XrApp } from '../../contracts/app';
import type { Unsubscribe } from '../../contracts/common';
import type { IconName } from '../../look/icons';
import { fitLines, paintIcon, paintKicker, paintPlate, PLATE, PX_PER_DMM } from '../../look/paint';
import { ACCENT, FIGURE_ACCENT, INK, MUTED, PAPER, RULE, SHADOW } from '../../look/palette';
import { dmm, TYPE, type TypeRole } from '../../look/type';
import { movable } from '../../ui/panels';
import { uploadNow } from '../../look/upload';

export interface ButtonLook {
  readonly primary?: boolean;
  readonly selected?: boolean;
  readonly icon?: IconName;
  readonly tone?: 'good' | 'bad';
}

/** What a paint function draws with. Coordinates are canvas px; `u` is px per dmm. */
export interface PanelUi {
  readonly g: CanvasRenderingContext2D;
  readonly W: number;
  readonly H: number;
  readonly u: number;
  button(id: string, x: number, y: number, w: number, h: number, label: string, onSelect: () => void, look?: ButtonLook): void;
  /** Wrapped text from (x, y) top-left; returns the y under it. */
  text(text: string, x: number, y: number, maxWidth: number, o?: { role?: TypeRole; size?: number; colour?: string; maxLines?: number }): number;
  kicker(text: string, x: number, y: number, colour?: string): void;
  icon(name: IconName, x: number, y: number, size: number, colour?: string): void;
  rule(y: number): void;
}

export interface LabPanel {
  readonly group: Group;
  readonly hovered: string | null;
  draw(key: string, paint: (ui: PanelUi) => void): void;
  /** Forces the next draw. */
  invalidate(): void;
  setVisible(v: boolean): void;
  dispose(): void;
}

interface Hit {
  mesh: Mesh;
  off: Unsubscribe;
  onSelect: () => void;
}

export function createLabPanel(app: XrApp, o: { id: string; widthM: number; heightM: number; distanceM: number; movable?: boolean }): LabPanel {
  const perM = PX_PER_DMM / dmm(1, o.distanceM);
  const k = Math.min(1, 2048 / Math.max(o.widthM * perM, o.heightM * perM));
  const W = Math.round(o.widthM * perM * k);
  const H = Math.round(o.heightM * perM * k);
  const u = PX_PER_DMM * k;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  const mat = new MeshBasicMaterial({ map: tex, alphaTest: 0.5, toneMapped: false });
  const plate = new Mesh(new PlaneGeometry(o.widthM, o.heightM), mat);
  plate.name = `lab-panel:${o.id}`;
  const group = new Group();
  group.name = `lab-panel-group:${o.id}`;
  group.add(plate);
  // The plate takes rays, so pointing at the panel never reaches the bench behind it.
  const offPlate = app.input.bind(plate, { id: `${o.id}/plate`, ray: true }, () => undefined);
  // The shared grip bar under the panel moves it (ui/panels).
  const grip = o.movable === false ? null : movable(app, { id: `lab/${o.id}`, group, width: o.widthM, height: o.heightM, distanceM: o.distanceM });
  const hitMat = new MeshBasicMaterial({ visible: false });
  const hitGeo = new PlaneGeometry(1, 1);
  const hits = new Map<string, Hit>();
  let hovered: string | null = null;
  let last: string | null = null;
  let lastPaint: ((ui: PanelUi) => void) | null = null;
  let lastKey = '';
  const toLocal = (x: number, y: number, w: number, h: number, m: Object3D) => {
    m.position.set(((x + w / 2) / W - 0.5) * o.widthM, (0.5 - (y + h / 2) / H) * o.heightM, 0.001);
    m.scale.set((w / W) * o.widthM, (h / H) * o.heightM, 1);
  };

  const redraw = (force: boolean, key: string, paint: (ui: PanelUi) => void) => {
    const fullKey = `${key}|${hovered ?? ''}`;
    if (!force && fullKey === last) return;
    last = fullKey;
    lastKey = key;
    lastPaint = paint;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, W, H);
    paintPlate(g, 0, 0, W, H, { fill: PAPER, ink: INK, border: PLATE.border * u, radius: PLATE.radius * u, shadow: PLATE.shadow * u, shadowColor: SHADOW });
    const seen = new Set<string>();
    const ui: PanelUi = {
      g,
      W,
      H,
      u,
      button(id, x, y, w, h, label, onSelect, look = {}) {
        seen.add(id);
        const hot = hovered === id;
        const fill = hot ? ACCENT : look.primary ? ACCENT : look.selected ? FIGURE_ACCENT : look.tone === 'good' ? '#b9dcc4' : look.tone === 'bad' ? '#f0b3a5' : PAPER;
        paintPlate(g, x, y, w, h, { fill, ink: INK, border: (hot ? 3.5 : 2.5) * u, radius: Math.min(12 * u, h * 0.3), shadow: hot ? 0 : 4 * u, shadowColor: SHADOW });
        const iconPx = look.icon ? 26 * u : 0;
        const lines = h >= 50 * u ? 2 : 1;
        const fit = fitLines(g, label, { role: TYPE.label, size: TYPE.label.size * u * (lines === 2 ? 0.9 : 1), minSize: TYPE.caption.size * u * 0.9, maxWidth: w - 24 * u - iconPx, maxLines: lines });
        g.fillStyle = INK;
        g.textBaseline = 'middle';
        g.textAlign = 'center';
        const cx = x + (w - 4 * u) / 2 + iconPx / 2;
        const cy = y + (h - 4 * u) / 2 - ((fit.lines.length - 1) * fit.lineHeight) / 2;
        if (look.icon) paintIcon(g, look.icon, cx - g.measureText(fit.lines[0] ?? '').width / 2 - iconPx - 6 * u, y + (h - 4 * u) / 2 - iconPx / 2, iconPx, INK);
        fit.lines.forEach((l, i) => g.fillText(l, cx, cy + i * fit.lineHeight));
        let hit = hits.get(id);
        if (!hit) {
          const mesh = new Mesh(hitGeo, hitMat);
          mesh.name = `lab-ui:${o.id}:${id}`;
          group.add(mesh);
          const entry: Hit = { mesh, onSelect, off: () => undefined };
          entry.off = app.input.bind(mesh, { id: mesh.name, ray: true, poke: true }, (e) => {
            if (e.type === 'hover-start' || e.type === 'hover-end') {
              hovered = e.type === 'hover-start' ? id : hovered === id ? null : hovered;
              if (lastPaint) redraw(true, lastKey, lastPaint);
            }
            if (e.type === 'select') {
              if (e.pointer.hand) app.input.pulse(e.pointer.hand, 0.35, 12);
              entry.onSelect();
            }
          });
          hit = entry;
          hits.set(id, hit);
        }
        hit.onSelect = onSelect;
        toLocal(x, y, w, h, hit.mesh);
        hit.mesh.visible = true;
        (hit.mesh as unknown as { pointerEvents: string }).pointerEvents = 'auto';
      },
      text(text, x, y, maxWidth, t = {}) {
        const role = t.role ?? TYPE.body;
        const fit = fitLines(g, text, { role, size: (t.size ?? role.size) * u, maxWidth, maxLines: t.maxLines ?? 4 });
        g.fillStyle = t.colour ?? INK;
        g.textAlign = 'left';
        g.textBaseline = 'top';
        fit.lines.forEach((l, i) => g.fillText(l, x, y + i * fit.lineHeight));
        return y + fit.lines.length * fit.lineHeight;
      },
      kicker: (text, x, y, colour = MUTED) => paintKicker(g, text, x, y, TYPE.kicker.size * u, colour),
      icon: (name, x, y, size, colour = INK) => paintIcon(g, name, x, y, size, colour),
      rule(y) {
        g.strokeStyle = RULE;
        g.lineWidth = 2 * u;
        g.beginPath();
        g.moveTo(PLATE.padding * u, y);
        g.lineTo(W - PLATE.padding * u - PLATE.shadow * u, y);
        g.stroke();
      },
    };
    paint(ui);
    for (const [id, hit] of hits) {
      if (seen.has(id)) continue;
      hit.mesh.visible = false;
      (hit.mesh as unknown as { pointerEvents: string }).pointerEvents = 'none';
      if (hovered === id) hovered = null;
    }
    tex.needsUpdate = true;
    uploadNow(tex);
  };

  return {
    group,
    get hovered() {
      return hovered;
    },
    draw: (key, paint) => redraw(false, key, paint),
    invalidate() {
      last = null;
    },
    setVisible(v) {
      group.visible = v;
      (plate as unknown as { pointerEvents: string }).pointerEvents = v ? 'auto' : 'none';
      for (const hit of hits.values()) (hit.mesh as unknown as { pointerEvents: string }).pointerEvents = v && hit.mesh.visible ? 'auto' : 'none';
    },
    dispose() {
      grip?.dispose();
      offPlate();
      for (const h of hits.values()) h.off();
      hits.clear();
      tex.dispose();
      mat.dispose();
      plate.geometry.dispose();
      hitMat.dispose();
      hitGeo.dispose();
      group.removeFromParent();
    },
  };
}

