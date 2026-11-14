/**
 * A block of text on a panel: wraps, shrinks at most 15 %, then ellipsises (XR_DESIGN.md 9.5), in a type role, with
 * an optional kicker over it. Transparent around the text, so it sits on the panel's paper.
 *
 *   const t = shellText({ w: 0.6, h: 0.08, distanceM: 1.3 }); panel.add(t, 0, y); t.set('Nothing here yet.');
 */
import { Group } from '@iwsdk/core';
import { fitLines, paintKicker } from '../../look/paint';
import { INK, MUTED } from '../../look/palette';
import { TYPE, type TypeName } from '../../look/type';
import { canvasFace } from './face';
import type { Fading } from './panel';

export interface ShellText extends Fading {
  set(text: string, o?: { role?: TypeName; kicker?: string; align?: CanvasTextAlign; colour?: string; maxLines?: number }): void;
}

export function shellText(o: { w: number; h: number; distanceM: number }): ShellText {
  const group = new Group();
  const face = canvasFace(o.w, o.h, o.distanceM, { order: 21 });
  group.add(face.mesh);
  return {
    group,
    set(text, s = {}) {
      face.draw(JSON.stringify([text, s]), (g, w, h) => {
        const role = TYPE[s.role ?? 'body'];
        let y = 0;
        if (s.kicker) {
          paintKicker(g, s.kicker, s.align === 'center' ? w / 2 : 0, TYPE.kicker.size * face.px * 0.6, TYPE.kicker.size * face.px, MUTED, s.align ?? 'left');
          y = TYPE.kicker.size * face.px * 1.5;
        }
        const size = role.size * face.px;
        const lines = Math.max(1, Math.min(s.maxLines ?? 6, Math.floor((h - y) / (size * 1.4))));
        const fit = fitLines(g, text, { role, size, maxWidth: w, maxLines: lines });
        g.fillStyle = s.colour ?? INK;
        g.textAlign = s.align ?? 'left';
        g.textBaseline = 'middle';
        const x = s.align === 'center' ? w / 2 : s.align === 'right' ? w : 0;
        fit.lines.forEach((l, i) => g.fillText(l, x, y + fit.lineHeight * (i + 0.5)));
      });
    },
    setOpacity: (a) => face.setOpacity(a),
    dispose() {
      group.removeFromParent();
      face.dispose();
    },
  };
}
