/**
 * The Code window's code: line numbers in a gutter and the sketch in mono, on one canvas face, with the running line's
 * inked highlight on a face of its own under it, so the highlight eases from line to line (a spring) without the code
 * being repainted. The window scrolls only when the marked line leaves the rows shown. A shell panel control (`Fading`).
 */
import { Group } from '@iwsdk/core';
import { canvasFace, type Fading } from '../../shell/kit';
import type { Ctx } from '../../shell/kit/face';
import { SPRINGS, stepSpring, springAtRest, type SpringState } from '../../look/motion';
import { paintPlate, useFont } from '../../look/paint';
import { FIGURE_ACCENT, INK, MUTED, RULE, SHADOW, STATE } from '../../look/palette';
import { dmm, TYPE } from '../../look/type';

/** One row, dmm: the code at 20 dmm (the type scale's code role) with room between lines. */
export const ROW_DMM = 28;
const GUTTER_DMM = 60;

export interface CodeBlock extends Fading {
  /** Shows these lines from the top, with no marker. */
  setLines(lines: readonly string[]): void;
  /** Marks a 1-based line, or nothing. */
  mark(line: number | null): void;
  /** The first row shown, 0-based (for scripts). */
  readonly top: number;
  /** Moves the rows shown by `rows` (Up and Down); the marker hides while its line is off the rows. */
  scroll(rows: number): void;
  /** Eases the marker; `instant` skips the ease (reduced motion). */
  tick(dt: number, instant: boolean): void;
}

const KEYWORDS = new Set('void if else for while do return const static unsigned long int bool boolean byte char float double uint8_t uint16_t uint32_t'.split(' '));
const VALUES = new Set(['HIGH', 'LOW', 'true', 'false', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'LED_BUILTIN']);

/** A line split into coloured runs: comments muted, strings green, numbers and pin levels red, keywords blue. */
export function runsOf(line: string): Array<{ text: string; colour: string }> {
  const out: Array<{ text: string; colour: string }> = [];
  const push = (text: string, colour: string) => text && out.push({ text, colour });
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    if (rest.startsWith('//')) {
      push(rest, MUTED);
      break;
    }
    const str = /^"(?:[^"\\]|\\.)*"?/.exec(rest);
    if (str && rest[0] === '"') {
      push(str[0], STATE.good);
      i += str[0].length;
      continue;
    }
    const word = /^[A-Za-z_]\w*|^\d+\w*|^#\w+/.exec(rest);
    if (word) {
      const w = word[0];
      push(w, /^\d/.test(w) || VALUES.has(w) ? STATE.bad : KEYWORDS.has(w) || w.startsWith('#') ? SHADOW : INK);
      i += w.length;
      continue;
    }
    const other = /^[^A-Za-z_\d"#/]+/.exec(rest)?.[0] ?? rest[0]!;
    push(other, INK);
    i += other.length;
  }
  return out;
}

export function codeBlock(o: { w: number; rows: number; distanceM: number }): CodeBlock {
  const D = o.distanceM;
  const rowM = dmm(ROW_DMM, D);
  const h = rowM * o.rows;
  const group = new Group();
  group.name = 'code-view:block';
  const face = canvasFace(o.w, h, D, { order: 22 });
  face.mesh.position.z = dmm(1.2, D);
  const band = canvasFace(o.w, rowM, D, { order: 21 });
  band.mesh.position.z = dmm(0.6, D);
  band.mesh.name = 'code-view:marker';
  group.add(band.mesh, face.mesh);
  const px = face.px;

  // The marker: a mustard plate with an ink outline and an ink pointer in the gutter, the figures' "this one".
  band.draw('band', (g: Ctx, w, hh) => {
    const b = 2.5 * px;
    paintPlate(g, 2 * px, 2 * px, w - 4 * px, hh - 4 * px, { fill: FIGURE_ACCENT, ink: INK, border: b, radius: 8 * px, shadow: 0 });
    g.fillStyle = INK;
    const cy = hh / 2;
    const x = 12 * px;
    g.beginPath();
    g.moveTo(x, cy - 7 * px);
    g.lineTo(x + 10 * px, cy);
    g.lineTo(x, cy + 7 * px);
    g.closePath();
    g.fill();
  });

  let lines: readonly string[] = [];
  let top = 0;
  let marked: number | null = null;
  let opacity = 0;
  const spring: SpringState = { x: 0, v: 0 };
  let alpha = 0;

  const rowY = (row: number) => h / 2 - (row + 0.5) * rowM;

  const paint = () => {
    face.draw(JSON.stringify([top, lines]), (g, w, hh) => {
      const size = TYPE.code.size * px;
      const row = ROW_DMM * px;
      const gutter = GUTTER_DMM * px;
      g.strokeStyle = RULE;
      g.lineWidth = 2 * px;
      g.beginPath();
      g.moveTo(gutter, 0);
      g.lineTo(gutter, hh);
      g.stroke();
      g.textBaseline = 'middle';
      for (let r = 0; r < o.rows; r++) {
        const n = top + r;
        const text = lines[n];
        if (text === undefined) break;
        const y = (r + 0.5) * row;
        useFont(g, TYPE.code, size);
        g.textAlign = 'right';
        g.fillStyle = MUTED;
        g.fillText(String(n + 1), gutter - 10 * px, y);
        g.textAlign = 'left';
        let x = gutter + 14 * px;
        const right = w - 8 * px;
        for (const run of runsOf(text.replace(/\t/g, '  '))) {
          const width = g.measureText(run.text).width;
          g.fillStyle = run.colour;
          if (x + width > right) {
            let t = run.text;
            while (t.length > 0 && x + g.measureText(t + '…').width > right) t = t.slice(0, -1);
            g.fillText(t + '…', x, y);
            break;
          }
          g.fillText(run.text, x, y);
          x += width;
        }
      }
    });
  };

  const apply = () => {
    face.setOpacity(opacity);
    band.setOpacity(opacity * alpha);
  };

  return {
    group,
    get top() {
      return top;
    },
    scroll(by) {
      const next = Math.max(0, Math.min(Math.max(0, lines.length - o.rows), top + by));
      if (next === top) return;
      top = next;
      paint();
    },
    setLines(next) {
      lines = next;
      top = 0;
      marked = null;
      paint();
    },
    mark(line) {
      const row = line === null || line < 1 || line > lines.length ? null : line - 1;
      marked = row;
      if (row === null) return;
      // Scroll only when the line leaves the rows shown (one row kept above and below), then jump the marker there.
      if (row < top + 1 || row > top + o.rows - 2) {
        const was = top;
        top = Math.max(0, Math.min(Math.max(0, lines.length - o.rows), row - Math.floor(o.rows / 3)));
        if (top !== was) {
          paint();
          spring.x = rowY(row - top);
          spring.v = 0;
        }
      }
      if (alpha === 0) {
        spring.x = rowY(row - top);
        spring.v = 0;
      }
    },
    tick(dt, instant) {
      const inView = marked !== null && marked >= top && marked < top + o.rows;
      const want = inView ? 1 : 0;
      const target = inView && marked !== null ? rowY(marked - top) : spring.x;
      if (instant) {
        spring.x = target;
        spring.v = 0;
        alpha = want;
      } else {
        if (!springAtRest(spring, target, rowM)) stepSpring(spring, target, SPRINGS.soft, dt);
        alpha = want > alpha ? Math.min(1, alpha + dt * 8) : Math.max(0, alpha - dt * 5);
      }
      band.mesh.position.y = spring.x;
      apply();
    },
    setOpacity(a) {
      opacity = a;
      apply();
    },
    dispose() {
      group.removeFromParent();
      face.dispose();
      band.dispose();
    },
  };
}
