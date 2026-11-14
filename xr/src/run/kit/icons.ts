/**
 * Line icons drawn into a canvas, in the spirit of Phosphor regular (9.4): round caps and joins, one stroke weight.
 * Every icon fits a square of side `s` centred on (x, y).
 *
 * Adapter: the spatial UI kit (#23) brings the Phosphor set; switch to it when it lands and keep the names.
 */
export type IconName =
  | 'run'
  | 'pause'
  | 'step'
  | 'reset'
  | 'speed'
  | 'stop'
  | 'warn'
  | 'hot'
  | 'burnt'
  | 'short'
  | 'pass'
  | 'fail'
  | 'info'
  | 'restart'
  | 'away'
  | 'close'
  | 'probe'
  | 'meter'
  | 'scope'
  | 'serial'
  | 'card';

type Ctx = CanvasRenderingContext2D;

export function drawIcon(g: Ctx, name: IconName, x: number, y: number, s: number, colour: string): void {
  const u = s / 24;
  g.save();
  g.translate(x - s / 2, y - s / 2);
  g.scale(u, u);
  g.strokeStyle = colour;
  g.fillStyle = colour;
  g.lineWidth = 2;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const path = (pts: ReadonlyArray<readonly [number, number]>, close = false) => {
    g.beginPath();
    pts.forEach(([px, py], i) => (i === 0 ? g.moveTo(px, py) : g.lineTo(px, py)));
    if (close) g.closePath();
    g.stroke();
  };
  const circle = (cx: number, cy: number, r: number, fill = false) => {
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    if (fill) g.fill();
    else g.stroke();
  };
  switch (name) {
    case 'run':
      path([[7, 4], [20, 12], [7, 20]], true);
      break;
    case 'pause':
      path([[8, 5], [8, 19]]);
      path([[16, 5], [16, 19]]);
      break;
    case 'step':
      path([[5, 5], [15, 12], [5, 19]], true);
      path([[19, 5], [19, 19]]);
      break;
    case 'stop':
      g.strokeRect(5, 5, 14, 14);
      break;
    case 'reset':
    case 'restart':
      g.beginPath();
      g.arc(12, 12, 7.5, Math.PI * 1.15, Math.PI * 2.75);
      g.stroke();
      path([[3.5, 4.5], [5.2, 9.2], [9.8, 7.6]]);
      if (name === 'restart') path([[10.5, 9.5], [15, 12], [10.5, 14.5]], true);
      break;
    case 'speed':
      g.beginPath();
      g.arc(12, 15, 8.5, Math.PI, Math.PI * 2);
      g.stroke();
      path([[12, 15], [16.5, 9.5]]);
      circle(12, 15, 1.2, true);
      break;
    case 'warn':
      path([[12, 3.5], [21.5, 20], [2.5, 20]], true);
      path([[12, 9.5], [12, 14]]);
      circle(12, 17, 0.9, true);
      break;
    case 'hot':
      g.beginPath();
      g.moveTo(12, 21);
      g.bezierCurveTo(6, 21, 5, 15, 8, 11);
      g.bezierCurveTo(9, 14, 11, 14, 11, 12);
      g.bezierCurveTo(11, 8, 13, 5, 14, 3);
      g.bezierCurveTo(16, 7, 19, 10, 19, 14);
      g.bezierCurveTo(19, 18, 16, 21, 12, 21);
      g.stroke();
      break;
    case 'burnt':
      for (const [cx, w] of [[8, 1], [12, -1], [16, 1]] as const) {
        g.beginPath();
        g.moveTo(cx, 21);
        g.bezierCurveTo(cx + 3 * w, 17, cx - 3 * w, 13, cx, 9);
        g.bezierCurveTo(cx + 2 * w, 7, cx, 5, cx, 3);
        g.stroke();
      }
      break;
    case 'short':
      path([[13.5, 2.5], [6, 13.5], [12, 13.5], [10.5, 21.5], [18, 10.5], [12, 10.5]], true);
      break;
    case 'pass':
      path([[5, 12.5], [10, 17.5], [19.5, 7]]);
      break;
    case 'fail':
    case 'close':
      path([[6, 6], [18, 18]]);
      path([[18, 6], [6, 18]]);
      break;
    case 'info':
      circle(12, 12, 9);
      path([[12, 11], [12, 17]]);
      circle(12, 7.8, 0.9, true);
      break;
    case 'away':
      g.beginPath();
      g.arc(12, 12, 8, Math.PI * 0.3, Math.PI * 1.7);
      g.bezierCurveTo(10, 8, 10, 16, 17.5, 17.5);
      g.stroke();
      break;
    case 'probe':
      path([[4, 20], [9, 15]]);
      g.beginPath();
      g.moveTo(9, 15);
      g.lineTo(17.5, 6.5);
      g.lineTo(20, 4);
      g.stroke();
      path([[7.5, 13.5], [10.5, 16.5]]);
      break;
    case 'meter':
      g.strokeRect(5, 3, 14, 18);
      g.strokeRect(8, 6, 8, 4);
      circle(12, 15.5, 3);
      break;
    case 'scope':
      g.strokeRect(3, 5, 18, 14);
      path([[5, 14], [8, 14], [9.5, 9], [12, 15], [14, 9], [15.5, 14], [19, 14]]);
      break;
    case 'serial':
      g.strokeRect(3, 5, 18, 14);
      path([[7, 10], [10, 12], [7, 14]]);
      path([[12, 14.5], [16, 14.5]]);
      break;
    case 'card':
      g.strokeRect(6, 3, 12, 18);
      path([[9, 8], [15, 8]]);
      path([[9, 12], [15, 12]]);
      break;
  }
  g.restore();
}
