/**
 * Icons drawn on canvas in the manner of Phosphor regular (design 9.4): round caps, a stroke of 1/16 of the size.
 * State icons pair with a word and a colour (9.3): empty circle (not run), ring of dots (running), tick in a `good`
 * circle (passed), cross in a `bad` circle (failed), warning triangle.
 *
 * Usage: drawIcon(g, 'pass', 120, 80, 58, k);
 */
import type { Tokens } from './tokens';

export type IconName =
  | 'idle'
  | 'running'
  | 'pass'
  | 'fail'
  | 'warn'
  | 'info'
  | 'back'
  | 'next'
  | 'eye'
  | 'play'
  | 'close'
  | 'grip'
  | 'steps'
  | 'code'
  | 'checks'
  | 'tick';

/** Draws `name` centred on (cx, cy), `d` pixels across; `colour` overrides the ink of line icons. */
export function drawIcon(g: CanvasRenderingContext2D, name: IconName, cx: number, cy: number, d: number, k: Tokens, colour?: string, phase = 0): void {
  const s = d / 16;
  const ink = colour ?? k.ink;
  g.save();
  g.translate(cx, cy);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = Math.max(1.5, s * 1.5);
  g.strokeStyle = ink;
  g.fillStyle = ink;
  const circle = (r: number) => {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
  };
  const poly = (pts: ReadonlyArray<readonly [number, number]>) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s)));
  };
  switch (name) {
    case 'idle':
      circle(6.5 * s);
      g.stroke();
      break;
    case 'running':
      for (let i = 0; i < 8; i++) {
        const a = phase + (i * Math.PI) / 4;
        g.globalAlpha = 0.35 + (0.65 * i) / 7;
        g.beginPath();
        g.arc(Math.cos(a) * 6 * s, Math.sin(a) * 6 * s, 1.25 * s, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      break;
    case 'pass':
    case 'fail':
      g.fillStyle = name === 'pass' ? k.good : k.bad;
      circle(7.5 * s);
      g.fill();
      g.strokeStyle = k.paper;
      g.lineWidth = s * 1.8;
      if (name === 'pass') poly([[-3.5, 0.2], [-1, 2.8], [3.8, -2.4]]);
      else {
        poly([[-2.8, -2.8], [2.8, 2.8]]);
        g.stroke();
        poly([[2.8, -2.8], [-2.8, 2.8]]);
      }
      g.stroke();
      break;
    case 'warn':
      g.fillStyle = colour ?? k.warn;
      poly([[0, -7], [7.6, 6.2], [-7.6, 6.2]]);
      g.closePath();
      g.lineWidth = s * 1.2;
      g.strokeStyle = colour ?? k.warn;
      g.fill();
      g.stroke();
      g.strokeStyle = k.paper;
      g.lineWidth = s * 1.6;
      poly([[0, -2.2], [0, 1.8]]);
      g.stroke();
      g.fillStyle = k.paper;
      g.beginPath();
      g.arc(0, 4.2, s * 0.95, 0, Math.PI * 2);
      g.fill();
      break;
    case 'info':
      circle(7 * s);
      g.stroke();
      poly([[0, -0.5], [0, 3.8]]);
      g.stroke();
      g.beginPath();
      g.arc(0, -3.4, s * 0.9, 0, Math.PI * 2);
      g.fill();
      break;
    case 'back':
      poly([[2.5, -5.5], [-3, 0], [2.5, 5.5]]);
      g.stroke();
      break;
    case 'next':
      poly([[-2.5, -5.5], [3, 0], [-2.5, 5.5]]);
      g.stroke();
      break;
    case 'eye':
      g.beginPath();
      g.moveTo(-7 * s, 0);
      g.quadraticCurveTo(0, -7.5 * s, 7 * s, 0);
      g.quadraticCurveTo(0, 7.5 * s, -7 * s, 0);
      g.closePath();
      g.stroke();
      circle(2.4 * s);
      g.stroke();
      break;
    case 'play':
      poly([[-3.5, -5.5], [5, 0], [-3.5, 5.5]]);
      g.closePath();
      g.stroke();
      break;
    case 'close':
      poly([[-4.5, -4.5], [4.5, 4.5]]);
      g.stroke();
      poly([[4.5, -4.5], [-4.5, 4.5]]);
      g.stroke();
      break;
    case 'grip':
      for (const x of [-4.5, 0, 4.5]) {
        g.beginPath();
        g.arc(x * s, 0, 1.3 * s, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'steps':
      for (const y of [-4, 0, 4]) {
        g.beginPath();
        g.arc(-5 * s, y * s, 0.9 * s, 0, Math.PI * 2);
        g.fill();
        poly([[-2, y], [6, y]]);
        g.stroke();
      }
      break;
    case 'code':
      poly([[-3, -4.5], [-7, 0], [-3, 4.5]]);
      g.stroke();
      poly([[3, -4.5], [7, 0], [3, 4.5]]);
      g.stroke();
      break;
    case 'checks':
      poly([[-7, -3.5], [-5.5, -2], [-2.5, -5]]);
      g.stroke();
      poly([[-7, 3.5], [-5.5, 5], [-2.5, 2]]);
      g.stroke();
      poly([[0.5, -3.5], [7, -3.5]]);
      g.stroke();
      poly([[0.5, 3.5], [7, 3.5]]);
      g.stroke();
      break;
    case 'tick':
      poly([[-5, 0.5], [-1.5, 4], [5.5, -3.5]]);
      g.stroke();
      break;
  }
  g.restore();
}
