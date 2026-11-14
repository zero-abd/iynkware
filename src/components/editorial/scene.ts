// The workshop of the landing hero: a desk under a window, drawn procedurally in a 192 x 120 space at 2x. GlyphScene
// samples the result into glyphs. `t` is the time of day (0 dawn, 1/3 noon, 2/3 dusk, 1 night), `time` is seconds.
//
// The room is painted in its own colours and then lit: a light layer (the sky's ambient, the sun through the window,
// the desk lamp, the monitor) multiplies it, so at night only what the lamp reaches stays bright. Dragging the slider
// rebuilds the static layers; each frame draws only what moves: clouds, stars, the screen, LEDs, readouts and smoke.

export const SCENE_W = 192;
export const SCENE_H = 120;
const SCALE = 2;

type RGB = [number, number, number];
type Ctx = CanvasRenderingContext2D;

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const mul = (a: RGB, b: RGB): RGB => [(a[0] * b[0]) / 255, (a[1] * b[1]) / 255, (a[2] * b[2]) / 255];
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const rgba = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (a: number, b: number, v: number) => {
  const k = clamp01((v - a) / (b - a));
  return k * k * (3 - 2 * k);
};
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

type Sky = { t: number; top: RGB; mid: RGB; bottom: RGB; ambient: RGB; level: number; night: number; sun: RGB };

const SKIES: Sky[] = [
  { t: 0, top: hex("#5b6aa6"), mid: hex("#e2a0a2"), bottom: hex("#ffd3a6"), ambient: hex("#f4d8ca"), level: 0.6, night: 0.2, sun: hex("#ffcf96") },
  { t: 0.33, top: hex("#4a8ed4"), mid: hex("#8fc0e8"), bottom: hex("#d8ecf8"), ambient: hex("#fbf6ee"), level: 0.8, night: 0, sun: hex("#fff3dc") },
  { t: 0.66, top: hex("#3e4185"), mid: hex("#c26c86"), bottom: hex("#ffad66"), ambient: hex("#ffcb9e"), level: 0.5, night: 0.35, sun: hex("#ffa458") },
  { t: 1, top: hex("#070c22"), mid: hex("#101b3e"), bottom: hex("#1d2c58"), ambient: hex("#7083bd"), level: 0.23, night: 1, sun: hex("#ffa458") },
];

function skyAt(t: number): Sky {
  const clamped = clamp01(t);
  let i = 0;
  while (i < SKIES.length - 2 && clamped > SKIES[i + 1].t) i++;
  const a = SKIES[i];
  const b = SKIES[i + 1];
  const k = smooth(0, 1, (clamped - a.t) / (b.t - a.t));
  return {
    t: clamped,
    top: mix(a.top, b.top, k),
    mid: mix(a.mid, b.mid, k),
    bottom: mix(a.bottom, b.bottom, k),
    ambient: mix(a.ambient, b.ambient, k),
    level: a.level + (b.level - a.level) * k,
    night: a.night + (b.night - a.night) * k,
    sun: mix(a.sun, b.sun, k),
  };
}

const WIN = { x: 12, y: 8, w: 62, h: 50 };
const HORIZON = 46;
const DESK_BACK = 76;
const DESK_FRONT = 104;
const DESK_EDGE = 108;
const MON = { x: 112, y: 44, w: 48, h: 29 };
const SHADE = { x: 169, y: 53.5 };
const POOL = { x: 163, y: 95 };

function rect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function round(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

function poly(ctx: Ctx, points: number[], color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath();
  ctx.fill();
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, color: string, rotation = 0) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
  ctx.fill();
}

function line(ctx: Ctx, points: number[], color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.stroke();
}

function glow(ctx: Ctx, x: number, y: number, r: number, color: RGB, alpha: number) {
  if (alpha <= 0.01) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.45, rgba(color, alpha * 0.35));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** A soft elliptical pool: full at the centre, gone at the rim. */
function pool(ctx: Ctx, x: number, y: number, rx: number, ry: number, color: RGB, alpha: number) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.55, rgba(color, alpha * 0.55));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
  ctx.restore();
}

/**
 * A box standing on the desk, seen from the front and a little above: `y` is where its front meets the desk, `d` its
 * depth as it recedes and `h` its height. The back leans toward the middle of the picture, so a side shows.
 */
function box(ctx: Ctx, x: number, y: number, w: number, d: number, h: number, top: string, front: string, side: string) {
  const lean = (SCENE_W / 2 - (x + w / 2)) * d * 0.005;
  const sx = lean > 0 ? x + w : x;
  poly(ctx, [sx, y, sx + lean, y - d, sx + lean, y - d - h, sx, y - h], side);
  rect(ctx, x, y - h, w, h, front);
  poly(ctx, [x, y - h, x + w, y - h, x + w + lean, y - h - d, x + lean, y - h - d], top);
  return { top: y - h - d, bottom: y - h, lean };
}

function newLayer() {
  const canvas = document.createElement("canvas");
  canvas.width = SCENE_W * SCALE;
  canvas.height = SCENE_H * SCALE;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(SCALE, SCALE);
    ctx.imageSmoothingEnabled = true;
  }
  return { canvas, ctx };
}

function sunPosition(t: number) {
  const p = t / 0.7;
  const y = HORIZON + 2 - Math.sin(Math.min(p, 1.2) * Math.PI) * 34;
  return { x: WIN.x + 6 + p * (WIN.w - 12), y, elevation: clamp01((HORIZON - y) / 34) };
}

/** How much sun comes through the window: none once it has set. */
const sunlight = (sky: Sky) => 1 - smooth(0.66, 0.8, sky.t);
/** The desk lamp goes on as the room darkens. */
const lamplight = (sky: Sky) => smooth(0.08, 0.4, sky.night) * (0.75 + 0.35 * sky.night);

function drawSky(ctx: Ctx, sky: Sky) {
  const { x, y, w, h } = WIN;
  const g = ctx.createLinearGradient(0, y, 0, HORIZON + 4);
  g.addColorStop(0, rgba(sky.top));
  g.addColorStop(0.55, rgba(sky.mid));
  g.addColorStop(1, rgba(sky.bottom));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);

  const sun = sunPosition(sky.t);
  const shown = sunlight(sky);
  glow(ctx, sun.x, sun.y, 30, sky.sun, 0.5 * shown);
  glow(ctx, sun.x, HORIZON, 44, mix(sky.sun, sky.bottom, 0.5), 0.3 * shown);
  ellipse(ctx, sun.x, sun.y, 3.4, 3.4, rgba(mix(sky.sun, [255, 255, 255], 0.6), shown));

  const moon = smooth(0.72, 0.92, sky.t);
  if (moon > 0) {
    const k = clamp01((sky.t - 0.7) / 0.3);
    const mx = x + 16 + k * (w - 34);
    const my = y + 12 - Math.sin(k * Math.PI) * 4;
    glow(ctx, mx, my, 16, hex("#a9bcf0"), 0.35 * moon);
    ellipse(ctx, mx, my, 2.6, 2.6, `rgba(236,238,246,${moon})`);
    ellipse(ctx, mx - 0.7, my - 0.4, 0.6, 0.5, `rgba(190,196,214,${moon})`);
    ellipse(ctx, mx + 0.8, my + 0.7, 0.45, 0.4, `rgba(190,196,214,${moon})`);
  }
}

function drawLandscape(ctx: Ctx, sky: Sky) {
  const { x, y, w, h } = WIN;
  const dim = 1 - sky.night * 0.8;
  const tone = (base: string, haze: number) => {
    const lit = mul(hex(base), mix([255, 255, 255], sky.ambient, 0.85));
    return rgba(mix(mix(lit, sky.bottom, haze), [5, 9, 22], (1 - dim) * 0.88));
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  // far ridge, lost in haze
  ctx.fillStyle = tone("#6f86a0", 0.62);
  ctx.beginPath();
  ctx.moveTo(x, HORIZON - 1);
  ctx.bezierCurveTo(x + 12, HORIZON - 7, x + 22, HORIZON - 6, x + 30, HORIZON - 3);
  ctx.bezierCurveTo(x + 40, HORIZON - 9, x + 52, HORIZON - 6, x + w, HORIZON - 4);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.fill();

  // the edge of town: blocks of different heights, some windows lit after dark
  const blocks: [number, number, number][] = [[2, 5, 6], [7, 8, 4], [11.5, 4, 7], [16, 10, 5], [21.5, 6, 6], [28, 3, 8], [36, 7, 5], [41.5, 12, 4], [46, 5, 6], [52.5, 8, 5]];
  const windows = smooth(0.25, 0.75, sky.night);
  for (const [bx, bh, bw] of blocks) {
    const left = x + bx;
    const top = HORIZON + 1 - bh;
    rect(ctx, left, top, bw, bh + 2, tone("#58616e", 0.42));
    if (windows <= 0) continue;
    for (let wy = top + 1; wy < HORIZON; wy += 1.6) {
      for (let wx = left + 0.8; wx < left + bw - 0.8; wx += 1.4) {
        if (hash(wx * 13.1 + wy * 7.7) > 0.55) continue;
        rect(ctx, wx, wy, 0.6, 0.7, `rgba(255,${200 + Math.round(hash(wx + wy) * 40)},130,${(windows * 0.85).toFixed(2)})`);
      }
    }
  }

  // nearer hill and the field below the window
  ctx.fillStyle = tone("#4d6a48", 0.25);
  ctx.beginPath();
  ctx.moveTo(x, HORIZON + 3);
  ctx.bezierCurveTo(x + 16, HORIZON - 1, x + 30, HORIZON + 5, x + 44, HORIZON + 2);
  ctx.bezierCurveTo(x + 54, HORIZON, x + 60, HORIZON + 1, x + w, HORIZON);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.fill();
  const field = ctx.createLinearGradient(0, HORIZON + 2, 0, y + h);
  field.addColorStop(0, tone("#5e7a4a", 0.18));
  field.addColorStop(1, tone("#3b5232", 0.05));
  ctx.fillStyle = field;
  ctx.fillRect(x, HORIZON + 4, w, y + h - HORIZON - 4);

  // a tree close to the glass, on the right
  const leaf = tone("#2f4a2c", 0.04);
  const leafLit = tone("#4f6e3c", 0.06);
  rect(ctx, x + w - 9, HORIZON - 6, 1.6, 20, tone("#3a2c22", 0.04));
  const crown: [number, number, number][] = [[-8, -14, 6], [-2, -18, 7], [4, -13, 6.5], [-5, -8, 5.5], [3, -6, 5], [8, -18, 5]];
  for (const [dx, dy, r] of crown) ellipse(ctx, x + w - 8 + dx, HORIZON + dy, r, r * 0.85, leaf);
  for (const [dx, dy, r] of crown) ellipse(ctx, x + w - 9 + dx - r * 0.25, HORIZON + dy - r * 0.3, r * 0.55, r * 0.45, leafLit);
  ctx.restore();
}

type Light = { sun: number; lamp: number; sunAt: ReturnType<typeof sunPosition> };

/** Where a thing on the desk throws its shadow: away from the window by day and from the lamp at night. */
function shadow(ctx: Ctx, light: Light, x: number, y: number, rx: number, ry: number) {
  pool(ctx, x, y, rx * 1.05, ry + 0.6, [20, 14, 8], 0.32);
  const reach = 2 + (1 - light.sunAt.elevation) * 7;
  const away = (WIN.x + WIN.w / 2 - light.sunAt.x) * 0.04;
  pool(ctx, x + 2.5 + away + reach * 0.4, y + 0.6 + reach * 0.15, rx * 1.15 + reach * 0.3, ry + 0.8, [20, 14, 8], 0.34 * light.sun);
  const fromLamp = Math.max(-10, Math.min(10, (x - POOL.x) * 0.18));
  pool(ctx, x + fromLamp - 1.5, y + 0.8, rx * 1.2, ry + 0.9, [20, 14, 8], 0.42 * light.lamp);
}

function drawWall(ctx: Ctx) {
  const wall = ctx.createLinearGradient(0, 0, 0, DESK_BACK);
  wall.addColorStop(0, "#7f8a7e");
  wall.addColorStop(0.25, "#8e998c");
  wall.addColorStop(1, "#949e90");
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, SCENE_W, DESK_BACK);
  // painted plaster is never quite even
  for (let i = 0; i < 520; i++) {
    const px = hash(i * 3.1) * SCENE_W;
    const py = hash(i * 7.3) * DESK_BACK;
    ctx.fillStyle = hash(i * 1.7) > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
    ctx.fillRect(px, py, 0.8, 0.8);
  }
  // the corner where the wall meets the desk stays in shade
  const corner = ctx.createLinearGradient(0, DESK_BACK - 7, 0, DESK_BACK);
  corner.addColorStop(0, "rgba(30,24,18,0)");
  corner.addColorStop(1, "rgba(30,24,18,0.3)");
  ctx.fillStyle = corner;
  ctx.fillRect(0, DESK_BACK - 7, SCENE_W, 7);
}

function drawWindow(ctx: Ctx) {
  const { x, y, w, h } = WIN;
  round(ctx, x - 3.5, y - 3.5, w + 7, h + 7, 0.6, "#e7e3da");
  // the reveal: the frame sits deep in the wall, its sides catch the light differently
  poly(ctx, [x - 1.2, y - 1.2, x + w + 1.2, y - 1.2, x + w, y, x, y], "#b9b4aa");
  poly(ctx, [x - 1.2, y - 1.2, x, y, x, y + h, x - 1.2, y + h], "#d6d1c7");
  poly(ctx, [x + w + 1.2, y - 1.2, x + w, y, x + w, y + h, x + w + 1.2, y + h], "#c7c2b8");
  rect(ctx, x - 3.5, y - 3.5, w + 7, 0.6, "rgba(255,255,255,0.4)");
  // sill: a top that catches light and a front in shade
  rect(ctx, x - 5.5, y + h + 1.2, w + 11, 2.6, "#efebe3");
  rect(ctx, x - 5.5, y + h + 3.8, w + 11, 1.8, "#c4bfb5");
  rect(ctx, x - 5.5, y + h + 5.6, w + 11, 1.2, "rgba(30,24,18,0.25)");
}

function drawMuntins(ctx: Ctx, sky: Sky) {
  const { x, y, w, h } = WIN;
  const backlit = (c: string) => rgba(mix(hex(c), [40, 38, 36], 0.25 * (1 - sky.night)));
  rect(ctx, x + w / 2 - 0.9, y, 1.8, h, backlit("#e7e3da"));
  rect(ctx, x, y + h * 0.45 - 0.9, w, 1.8, backlit("#e7e3da"));
  rect(ctx, x, y + h - 1.2, w, 1.2, backlit("#d6d1c7"));
  // a plant on the sill, in a terracotta pot
  const px = x + 6;
  const py = y + h + 1.4;
  poly(ctx, [px - 3, py - 4.2, px + 3, py - 4.2, px + 2.3, py, px - 2.3, py], "#b5643e");
  rect(ctx, px - 3.3, py - 4.8, 6.6, 1, "#c97650");
  for (const [dx, dy, r, rot] of [[-2.5, -8, 2.6, -0.6], [0.5, -10, 3, 0.2], [2.8, -7.5, 2.4, 0.8], [-0.5, -6.5, 2.2, -0.2]] as const) {
    ellipse(ctx, px + dx, py + dy, r * 0.55, r, "#3f6b3a", rot);
    ellipse(ctx, px + dx - 0.3, py + dy - 0.4, r * 0.25, r * 0.6, "#5b8a4c", rot);
  }
}

function drawPegboard(ctx: Ctx) {
  rect(ctx, 85, 7, 46, 36, "#9b7a55");
  rect(ctx, 86, 8, 44, 34, "#b8946a");
  ctx.fillStyle = "rgba(60,42,24,0.55)";
  for (let hy = 10; hy < 41; hy += 2.5) for (let hx = 88; hx < 129; hx += 2.5) ctx.fillRect(hx, hy, 0.6, 0.6);
  rect(ctx, 86, 42, 44, 1.2, "rgba(30,24,18,0.25)");

  // pliers and flush cutters on hooks
  line(ctx, [92, 14, 92, 18.5], "#8c939a", 0.9);
  line(ctx, [92, 18, 90.4, 30], "#b03a2e", 1.5);
  line(ctx, [92, 18, 93.8, 30], "#c4473a", 1.5);
  line(ctx, [99, 15, 99, 19], "#8c939a", 0.9);
  line(ctx, [99, 18.6, 97.8, 28], "#2f5fa6", 1.4);
  line(ctx, [99, 18.6, 100.4, 28], "#3b70bd", 1.4);
  // screwdrivers in a rack
  rect(ctx, 104, 13, 14, 1.6, "#5c4a36");
  ["#e0b43a", "#26292c", "#c4473a", "#3b70bd"].forEach((color, i) => {
    const sx = 105.5 + i * 3.4;
    round(ctx, sx - 0.9, 14.6, 1.8, 5, 0.6, color);
    rect(ctx, sx - 0.25, 19.6, 0.5, 6.5 - i * 0.6, "#a7adb3");
  });
  // a coil of solder and spools of hook-up wire on a rod
  ctx.strokeStyle = "#9ea3a8";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(125, 19, 3, 0, Math.PI * 2);
  ctx.stroke();
  ellipse(ctx, 125, 19, 1.3, 1.3, "#6a5d4c");
  rect(ctx, 103, 34.2, 25, 0.8, "#6b6f73");
  ["#b03a2e", "#2a2c2e", "#d9a92e", "#3c7d4a"].forEach((color, i) => {
    const sx = 106 + i * 6;
    ellipse(ctx, sx, 34.6, 2.6, 3.2, "#4a4d50");
    ellipse(ctx, sx, 34.6, 2.1, 2.7, color);
    ellipse(ctx, sx - 0.6, 33.8, 0.8, 1.2, "rgba(255,255,255,0.18)");
    ellipse(ctx, sx, 34.6, 0.6, 0.7, "#2a2c2e");
  });
}

function drawShelf(ctx: Ctx) {
  // brackets, board and what stands on it
  poly(ctx, [144, 33, 148, 33, 144, 38], "#5c5f63");
  poly(ctx, [184, 33, 188, 33, 188, 38], "#5c5f63");
  // a drawer cabinet of small parts
  rect(ctx, 140, 12.5, 25, 17.5, "#5d6267");
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      const dx = 141 + c * 4.8;
      const dy = 13.6 + r * 4.1;
      rect(ctx, dx, dy, 4.1, 3.4, "#c9cdcb");
      rect(ctx, dx + 0.5, dy + 1.4, 3.1, 1.6, ["#b8513f", "#4a6fa5", "#d9a92e", "#6a9b5e", "#8a8f94"][(r * 5 + c) % 5]);
      rect(ctx, dx + 1.4, dy + 0.4, 1.3, 0.5, "#7d8285");
    }
  }
  // binders and a datasheet folder
  [["#34507a", 13.5], ["#7a3b37", 14.5], ["#2f4f3f", 13], ["#857452", 12.5]].forEach(([color, height], i) => {
    const bx = 168 + i * 4.7;
    const hgt = height as number;
    rect(ctx, bx, 30 - hgt, 4.4, hgt, color as string);
    rect(ctx, bx + 0.9, 30 - hgt + 2, 2.6, 3, "rgba(240,236,226,0.75)");
    rect(ctx, bx + 3.6, 30 - hgt, 0.8, hgt, "rgba(0,0,0,0.18)");
  });
  rect(ctx, 138, 30, 52, 1.8, "#c9a477");
  rect(ctx, 138, 31.8, 52, 1.4, "#8f6c48");
  rect(ctx, 138, 33.2, 52, 1.6, "rgba(30,24,18,0.22)");
}

function drawDesk(ctx: Ctx) {
  rect(ctx, 0, DESK_BACK, SCENE_W, DESK_FRONT - DESK_BACK, "#b88a5c");
  // butcher-block strips run from the front edge back toward the middle of the picture
  const strips = 18;
  for (let i = 0; i < strips; i++) {
    const a = (i / strips) * (SCENE_W + 60) - 30;
    const b = ((i + 1) / strips) * (SCENE_W + 60) - 30;
    const back = (v: number) => SCENE_W / 2 + (v - SCENE_W / 2) * 0.62;
    const k = hash(i * 9.1);
    poly(ctx, [back(a), DESK_BACK, back(b), DESK_BACK, b, DESK_FRONT, a, DESK_FRONT], rgba(mix(hex("#a87a4e"), hex("#c99b6a"), k)));
    line(ctx, [back(b), DESK_BACK, b, DESK_FRONT], "rgba(70,44,22,0.35)", 0.35);
  }
  // grain and a little wear
  for (let i = 0; i < 90; i++) {
    const gy = DESK_BACK + Math.pow(hash(i * 2.3), 0.8) * (DESK_FRONT - DESK_BACK);
    const gx = hash(i * 5.9) * SCENE_W;
    const len = 6 + hash(i * 1.1) * 18 * (0.5 + (gy - DESK_BACK) / 28);
    rect(ctx, gx, gy, len, 0.3, hash(i) > 0.5 ? "rgba(90,56,28,0.18)" : "rgba(255,230,190,0.1)");
  }
  const depth = ctx.createLinearGradient(0, DESK_BACK, 0, DESK_FRONT);
  depth.addColorStop(0, "rgba(40,26,14,0.32)");
  depth.addColorStop(0.18, "rgba(40,26,14,0.08)");
  depth.addColorStop(1, "rgba(255,240,220,0.06)");
  ctx.fillStyle = depth;
  ctx.fillRect(0, DESK_BACK, SCENE_W, DESK_FRONT - DESK_BACK);
  // the front edge, rounded over, and the dark under the desk
  rect(ctx, 0, DESK_FRONT, SCENE_W, 0.8, "#d8ad7e");
  rect(ctx, 0, DESK_FRONT + 0.8, SCENE_W, DESK_EDGE - DESK_FRONT - 0.8, "#7f5a38");
  rect(ctx, 0, DESK_EDGE, SCENE_W, SCENE_H - DESK_EDGE, "#241e1a");
  rect(ctx, 0, DESK_EDGE, SCENE_W, 1.6, "rgba(0,0,0,0.45)");
  round(ctx, 70, DESK_EDGE + 1.6, 52, 7, 0.6, "#352b24");
  rect(ctx, 90, DESK_EDGE + 4.6, 12, 1.1, "#6b6158");
}

function drawMonitor(ctx: Ctx) {
  const { x, y, w, h } = MON;
  ellipse(ctx, x + w / 2, 81.2, 10.5, 2.3, "#24272b");
  ellipse(ctx, x + w / 2, 80.7, 10, 1.8, "#3a3e43");
  rect(ctx, x + w / 2 - 2.6, y + h - 1, 5.2, 8.6, "#2c3035");
  rect(ctx, x + w / 2 - 2.6, y + h - 1, 1, 8.6, "rgba(255,255,255,0.08)");
  round(ctx, x, y, w, h, 0.8, "#16181b");
  rect(ctx, x + 1.1, y + 1.1, w - 2.2, h - 3.4, "#0a0d11");
  rect(ctx, x, y + h - 2.3, w, 2.3, "#1d2024");
  rect(ctx, x + 0.4, y + 0.3, w - 0.8, 0.4, "rgba(255,255,255,0.12)");
}

function drawDrone(ctx: Ctx) {
  const cx = 70;
  const cy = 80.6;
  const motors: [number, number][] = [[-11.5, 3.2], [11.5, 3.2], [-8.5, -2.4], [8.5, -2.4]];
  for (const [dx, dy] of motors) line(ctx, [cx, cy, cx + dx, cy + dy], "#1d2023", 1.6);
  for (const [dx, dy] of motors) line(ctx, [cx, cy - 0.4, cx + dx, cy + dy - 0.4], "#3a3f44", 0.5);
  // the stack: frame plate, flight controller and a LiPo strapped on top
  round(ctx, cx - 5.5, cy - 2.6, 11, 5.4, 1.2, "#1b1e21");
  round(ctx, cx - 4.4, cy - 4.4, 8.8, 3, 0.6, "#3f4448");
  rect(ctx, cx - 4.4, cy - 3.2, 8.8, 0.9, "#c8842f");
  rect(ctx, cx - 1.6, cy - 4.4, 0.9, 3, "#1b1e21");
  round(ctx, cx - 1.6, cy + 1.4, 3.2, 2, 0.5, "#0c0d0f");
  ellipse(ctx, cx, cy + 2.4, 0.7, 0.6, "#4f6a86");
  const turns = [0.22, -0.18, -0.3, 0.12];
  motors.forEach(([dx, dy], i) => {
    const mx = cx + dx;
    const my = cy + dy;
    rect(ctx, mx - 1.4, my - 2.2, 2.8, 2.2, "#2b2f33");
    ellipse(ctx, mx, my - 2.2, 1.4, 0.5, "#8d949a");
    // two-blade props at rest, each left at its own angle
    ellipse(ctx, mx, my - 2.6, 6.2, 0.7, "rgba(28,30,33,0.92)", turns[i]);
    ellipse(ctx, mx, my - 2.8, 5.8, 0.25, "rgba(120,126,132,0.45)", turns[i]);
  });
}

function drawStation(ctx: Ctx) {
  box(ctx, 95, 88, 19, 6, 7.4, "#3b3f45", "#2a2d32", "#202327");
  rect(ctx, 97, 81.8, 8.6, 4.2, "#0b0c0d");
  ellipse(ctx, 109.8, 84.2, 2, 2, "#1a1c1f");
  ellipse(ctx, 109.8, 84.2, 1.5, 1.5, "#5f656b");
  rect(ctx, 109.6, 82.8, 0.4, 1.3, "#d8dde0");
  rect(ctx, 97, 86.9, 15, 0.5, "#c4473a");
  // the iron's cord, then its stand: a brass-wool cup and a spring holder
  ctx.strokeStyle = "#1e2124";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(112.4, 87.2);
  ctx.bezierCurveTo(118, 93, 132, 90, 128.4, 80.6);
  ctx.stroke();
  ellipse(ctx, 121.5, 91.4, 6, 1.6, "#26292d");
  ellipse(ctx, 121.5, 90.9, 5.6, 1.2, "#3a3e43");
  ellipse(ctx, 116.6, 90.4, 2.2, 0.9, "#9a7a3c");
  for (let i = 0; i < 6; i++) ellipse(ctx, 116.6 + (hash(i) - 0.5) * 2.4, 90.1 + (hash(i * 3) - 0.5) * 0.8, 0.5, 0.35, "#d2ae62");
  ctx.strokeStyle = "#9aa1a7";
  ctx.lineWidth = 0.45;
  for (let i = 0; i < 7; i++) {
    const k = i / 6;
    ctx.beginPath();
    ctx.ellipse(120 + k * 5.2, 90 - k * 6.6, 1.5, 0.7, -0.9, 0, Math.PI * 2);
    ctx.stroke();
  }
  line(ctx, [128.6, 80.4, 122.4, 87.6], "#1d2125", 2.4);
  line(ctx, [123.6, 86.2, 122.6, 87.4], "#2f6fb0", 2.6);
  line(ctx, [122.4, 87.6, 119.2, 90.8], "#b9bfc4", 1.1);
  line(ctx, [119.2, 90.8, 118.2, 91.8], "#5d6165", 0.6);
}

function drawMug(ctx: Ctx) {
  ctx.strokeStyle = "#2a4363";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(184.6, 92.4, 1.9, 2.4, 0, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  rect(ctx, 176, 88.6, 8.4, 8.2, "#2f4b6e");
  ellipse(ctx, 180.2, 96.8, 4.2, 1.1, "#2f4b6e");
  rect(ctx, 176, 88.6, 1.6, 8.2, "rgba(255,255,255,0.1)");
  rect(ctx, 182.6, 88.6, 1.8, 8.2, "rgba(0,0,0,0.2)");
  ellipse(ctx, 180.2, 88.6, 4.2, 1.15, "#4a6a92");
  ellipse(ctx, 180.2, 88.8, 3.5, 0.8, "#3a2416");
}

function drawLamp(ctx: Ctx) {
  ellipse(ctx, 182, 85, 5.6, 1.7, "#202326");
  ellipse(ctx, 182, 84.4, 5, 1.3, "#33373b");
  rect(ctx, 181.2, 81, 1.6, 3.6, "#2b2f33");
  // two arms of paired rods with their springs
  line(ctx, [181.6, 81.4, 186.4, 55.4], "#8d949a", 0.6);
  line(ctx, [182.6, 81.4, 187.4, 55.4], "#8d949a", 0.6);
  for (let i = 0; i < 9; i++) {
    const k = 0.18 + i * 0.05;
    const sx = 183.4 + k * 5;
    const sy = 81 - k * 26;
    line(ctx, [sx, sy, sx + 0.8, sy - 0.7], "#b9bfc4", 0.35);
  }
  line(ctx, [186.6, 55, 174.6, 46.6], "#8d949a", 0.6);
  line(ctx, [187.4, 55.8, 175.2, 47.6], "#8d949a", 0.6);
  ellipse(ctx, 187, 55.4, 1.2, 1.2, "#2b2f33");
  ellipse(ctx, 174.8, 47, 1.1, 1.1, "#2b2f33");
  // a conical metal shade tipped toward the desk
  poly(ctx, [173.6, 45.6, 176.4, 47.6, SHADE.x + 5.6, SHADE.y + 1.6, SHADE.x - 5, SHADE.y - 2.6], "#3d4a59");
  poly(ctx, [173.6, 45.6, 175, 46.6, SHADE.x - 1, SHADE.y - 1.4, SHADE.x - 5, SHADE.y - 2.6], "rgba(255,255,255,0.12)");
  ellipse(ctx, SHADE.x, SHADE.y, 5.6, 1.9, "#2a333d", -0.38);
  ellipse(ctx, SHADE.x + 0.2, SHADE.y + 0.2, 4.6, 1.3, "#d8d2c0", -0.38);
}

function drawUno(ctx: Ctx) {
  const { top } = box(ctx, 16, 98, 32, 12, 1.3, "#00878f", "#005c63", "#00474d");
  const at = (u: number) => top + u * 12;
  // the left edge carries the USB-B socket and the barrel jack
  box(ctx, 13.4, at(0.42), 7.6, 4.6, 4.2, "#e1e5e8", "#aab0b6", "#8e959b");
  rect(ctx, 14.6, at(0.42) - 3.4, 4.2, 2.2, "#5e6469");
  box(ctx, 13.8, at(0.93), 6.4, 3.6, 3.6, "#2b2d30", "#141517", "#0e0f10");
  // headers along both long edges, the ATmega in its socket, crystal, caps and reset button
  box(ctx, 26, at(0.18), 20, 1.4, 1.5, "#2a2b2d", "#111213", "#0b0b0c");
  box(ctx, 28, at(1) - 0.6, 18, 1.4, 1.5, "#2a2b2d", "#111213", "#0b0b0c");
  ctx.fillStyle = "#c9a95a";
  for (let i = 0; i < 18; i++) ctx.fillRect(26.6 + i * 1.08, at(0.18) - 2.6, 0.45, 0.4);
  box(ctx, 31.5, at(0.75), 13, 3, 1.4, "#1c1d1f", "#0e0f10", "#0a0a0b");
  ctx.fillStyle = "#b9bfc4";
  for (let i = 0; i < 12; i++) ctx.fillRect(32 + i * 1.05, at(0.75) - 0.2, 0.4, 0.5);
  round(ctx, 24.4, at(0.58), 3, 1.2, 0.5, "#c9ced2");
  ellipse(ctx, 22.6, at(0.74), 1, 0.8, "#2a2c2e");
  ellipse(ctx, 22.6, at(0.7), 0.9, 0.45, "#7c8288");
  rect(ctx, 23, at(0.3), 2.2, 1.6, "#202225");
  ellipse(ctx, 24.1, at(0.32), 0.7, 0.4, "#d8d0bc");
  rect(ctx, 38, at(0.44), 6, 1.4, "rgba(255,255,255,0.55)");
}

function drawBreadboard(ctx: Ctx) {
  const { top } = box(ctx, 54, 100, 38, 11, 1.8, "#efece4", "#d3cfc4", "#c2beb3");
  const at = (u: number) => top + u * 11;
  rect(ctx, 55.4, at(0.08), 35.2, 0.35, "#c4473a");
  rect(ctx, 55.4, at(0.17), 35.2, 0.35, "#3b65b0");
  rect(ctx, 55.4, at(0.86), 35.2, 0.35, "#c4473a");
  rect(ctx, 55.4, at(0.95), 35.2, 0.35, "#3b65b0");
  rect(ctx, 54.6, at(0.5) - 0.35, 36.8, 0.7, "#cfcabd");
  ctx.fillStyle = "#8f8a7e";
  for (let c = 0; c < 23; c++) {
    const hx = 56 + c * 1.55;
    for (const u of [0.26, 0.33, 0.4, 0.6, 0.67, 0.74]) ctx.fillRect(hx, at(u), 0.5, 0.35);
  }
  // a resistor, a red LED and a push button
  line(ctx, [61.4, at(0.34), 69, at(0.34)], "#9da3a8", 0.3);
  round(ctx, 62.8, at(0.34) - 0.75, 4.8, 1.5, 0.7, "#d8bb8c");
  for (const [bx, color] of [[63.6, "#7a4a2a"], [64.6, "#2a2a2a"], [65.6, "#b03a2e"], [66.8, "#c9a95a"]] as const) rect(ctx, bx, at(0.34) - 0.75, 0.4, 1.5, color);
  line(ctx, [72, at(0.4), 72, at(0.3)], "#9da3a8", 0.3);
  line(ctx, [73.4, at(0.4), 73.4, at(0.3)], "#9da3a8", 0.3);
  round(ctx, 71.6, at(0.3) - 2.6, 2.2, 2.8, 1, "#b4302a");
  round(ctx, 80, at(0.6) - 0.4, 3.2, 2.6, 0.4, "#1f2124");
  ellipse(ctx, 81.6, at(0.6) + 0.8, 1, 0.7, "#6b7177");
}

function drawMultimeter(ctx: Ctx) {
  const { top } = box(ctx, 153, 103, 19, 11.5, 2.6, "#e6ab22", "#b88413", "#9a6f10");
  const at = (u: number) => top + u * 11.5;
  round(ctx, 155.2, at(0.08), 14.8, 10, 0.8, "#36393c");
  rect(ctx, 156.6, at(0.14), 12, 2.8, "#a3ad97");
  rect(ctx, 156.6, at(0.14), 12, 0.5, "rgba(0,0,0,0.18)");
  ellipse(ctx, 162.6, at(0.62), 2.7, 1.8, "#1f2123");
  ellipse(ctx, 162.6, at(0.6), 2.2, 1.4, "#4a4e52");
  line(ctx, [162.6, at(0.6), 161.2, at(0.48)], "#e8e2d2", 0.4);
  for (const [jx, color] of [[158, "#c4473a"], [162.6, "#1a1a1a"], [167.2, "#1a1a1a"]] as const) ellipse(ctx, jx, at(0.88), 0.8, 0.5, color);
  // test leads across the desk to the breadboard
  ctx.lineWidth = 0.75;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#b8352a";
  ctx.beginPath();
  ctx.moveTo(158, at(0.88));
  ctx.bezierCurveTo(150, 104, 112, 103, 89, at(-0.3) + 1);
  ctx.stroke();
  ctx.strokeStyle = "#1c1d1f";
  ctx.beginPath();
  ctx.moveTo(162.6, at(0.88));
  ctx.bezierCurveTo(154, 106, 116, 105.5, 89.5, at(0.1) + 2.6);
  ctx.stroke();
}

function drawJumpers(ctx: Ctx) {
  const jumpers: [string, number, number, number, number, number][] = [
    ["#c4473a", 40.5, 96.4, 57, 88.6, 5],
    ["#202225", 42.5, 96.4, 59, 89.6, 4],
    ["#d9a92e", 44.5, 86.6, 66, 91.4, 8],
    ["#3c8a52", 46, 86.6, 80.6, 94.8, 9],
    ["#3b65b0", 69.4, 91.4, 72, 90.6, 2],
  ];
  ctx.lineCap = "round";
  for (const [, x1, y1, x2, y2] of jumpers) {
    ctx.strokeStyle = "rgba(28,18,10,0.22)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x1 + 0.8, y1 + 1.2);
    ctx.quadraticCurveTo((x1 + x2) / 2 + 1.5, Math.max(y1, y2) + 1.4, x2 + 0.8, y2 + 1.2);
    ctx.stroke();
  }
  for (const [color, x1, y1, x2, y2, bow] of jumpers) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.95;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo((x1 + x2) / 2, Math.min(y1, y2) - bow, x2, y2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.moveTo(x1, y1 - 0.25);
    ctx.quadraticCurveTo((x1 + x2) / 2, Math.min(y1, y2) - bow - 0.25, x2, y2 - 0.25);
    ctx.stroke();
  }
}

/** The room in its own colours, with contact and cast shadows; lighting comes after. */
function drawRoom(ctx: Ctx, light: Light, sky: Sky) {
  drawWall(ctx);
  drawWindow(ctx);
  drawPegboard(ctx);
  drawShelf(ctx);
  drawDesk(ctx);

  shadow(ctx, light, MON.x + MON.w / 2, 81, 11, 2);
  shadow(ctx, light, 70, 83.2, 13, 2.4);
  shadow(ctx, light, 104.5, 86, 10.5, 3.4);
  shadow(ctx, light, 122, 91.4, 6.5, 1.8);
  shadow(ctx, light, 182, 85, 6, 1.8);
  shadow(ctx, light, 180.2, 96.6, 4.8, 1.4);
  shadow(ctx, light, 32, 92.6, 17, 6.4);
  shadow(ctx, light, 73, 94.8, 19.5, 5.8);
  shadow(ctx, light, 162.5, 97.4, 10, 6);

  drawMonitor(ctx);
  drawDrone(ctx);
  drawStation(ctx);
  drawLamp(ctx);
  drawMug(ctx);
  drawUno(ctx);
  drawBreadboard(ctx);
  drawJumpers(ctx);
  drawMultimeter(ctx);

  ctx.clearRect(WIN.x, WIN.y, WIN.w, WIN.h);
  drawMuntins(ctx, sky);
}

/** The light that reaches each point of the room, as a colour to multiply the room by. */
function drawIrradiance(ctx: Ctx, light: Light, sky: Sky) {
  rect(ctx, 0, 0, SCENE_W, SCENE_H, rgba(scale(sky.ambient, sky.level)));
  const day = 1 - sky.night;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // skylight through the window falls off across the room
  pool(ctx, WIN.x + WIN.w / 2, WIN.y + WIN.h * 0.7, 90, 62, mix(sky.mid, [255, 255, 255], 0.55), 0.3 * day);

  // the sun's patch on the desk: the panes, stretched long when the sun is low
  const { sun, sunAt } = light;
  if (sun > 0.02) {
    const length = 7 + (1 - sunAt.elevation) * 19;
    const across = (WIN.x + WIN.w / 2 - sunAt.x) * 0.9 + 8;
    const onDesk = (wx: number, wy: number): [number, number] => {
      const k = (WIN.y + WIN.h - wy) / WIN.h;
      return [wx + across + k * across * 0.5, Math.min(DESK_FRONT, DESK_BACK + 2 + k * length)];
    };
    const panes = [
      [WIN.x, WIN.y, WIN.x + WIN.w / 2 - 0.9, WIN.y + WIN.h * 0.45 - 0.9],
      [WIN.x + WIN.w / 2 + 0.9, WIN.y, WIN.x + WIN.w, WIN.y + WIN.h * 0.45 - 0.9],
      [WIN.x, WIN.y + WIN.h * 0.45 + 0.9, WIN.x + WIN.w / 2 - 0.9, WIN.y + WIN.h - 1.2],
      [WIN.x + WIN.w / 2 + 0.9, WIN.y + WIN.h * 0.45 + 0.9, WIN.x + WIN.w, WIN.y + WIN.h - 1.2],
    ];
    // three slightly offset passes give the patch a soft edge, as a real penumbra has
    for (const [spread, alpha] of [[0, 0.32], [0.9, 0.16], [-0.9, 0.16]] as const) {
      for (const [x0, y0, x1, y1] of panes) {
        const corners = [onDesk(x0 - spread, y1), onDesk(x1 + spread, y1), onDesk(x1 + spread, y0), onDesk(x0 - spread, y0)];
        poly(ctx, corners.flat(), rgba(sky.sun, alpha * sun));
      }
    }
  }

  // moonlight through the glass, cool and faint
  pool(ctx, WIN.x + WIN.w / 2 + 6, DESK_BACK + 8, 40, 9, hex("#9fb4e8"), 0.3 * smooth(0.75, 0.95, sky.t));

  const { lamp } = light;
  if (lamp > 0.01) {
    pool(ctx, POOL.x - 6, POOL.y, 58, 17, hex("#ffcf8e"), 0.9 * lamp);
    pool(ctx, POOL.x, POOL.y, 26, 8, hex("#fff0d0"), 0.6 * lamp);
    pool(ctx, SHADE.x - 8, SHADE.y, 60, 40, hex("#ffc27a"), 0.3 * lamp);
  }
  pool(ctx, MON.x + MON.w / 2, MON.y + MON.h + 4, 36, 16, hex("#a8c4ff"), 0.05 + 0.2 * sky.night);
  pool(ctx, 101, 86, 8, 4, hex("#ff6a46"), 0.14 * sky.night);
  ctx.restore();
}

/** Light seen in the air rather than on surfaces: haze at the glass, the lamp's bloom, the screen's halo. */
function drawBloom(ctx: Ctx, light: Light, sky: Sky) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const day = 1 - sky.night;
  glow(ctx, WIN.x + WIN.w / 2, WIN.y + WIN.h / 2, 48, mix(sky.bottom, [255, 255, 255], 0.3), 0.1 * day);
  if (light.sun > 0.02 && light.sunAt.elevation < 0.6) {
    // low sun lights the dust in its path
    const beam = ctx.createLinearGradient(WIN.x + WIN.w / 2, WIN.y + WIN.h, WIN.x + WIN.w + 30, DESK_FRONT);
    beam.addColorStop(0, rgba(sky.sun, 0.12 * light.sun * (1 - light.sunAt.elevation)));
    beam.addColorStop(1, rgba(sky.sun, 0));
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(WIN.x + 4, WIN.y + WIN.h);
    ctx.lineTo(WIN.x + WIN.w, WIN.y + WIN.h * 0.5);
    ctx.lineTo(WIN.x + WIN.w + 44, DESK_FRONT - 4);
    ctx.lineTo(WIN.x + 30, DESK_FRONT);
    ctx.closePath();
    ctx.fill();
  }
  glow(ctx, SHADE.x + 0.5, SHADE.y + 1, 14, hex("#ffd9a0"), 0.5 * light.lamp);
  glow(ctx, MON.x + MON.w / 2, MON.y + MON.h / 2, 34, hex("#7fa6e8"), 0.03 + 0.08 * sky.night);
  ctx.restore();
}

// The sketch on screen and the serial plotter beside it.
const CODE: [number, number, string][] = [
  [0, 9, "#c586c0"], [2, 13, "#9cdcfe"], [2, 10, "#dcdcaa"], [0, 2, "#d4d4d4"], [0, 7, "#c586c0"], [2, 12, "#dcdcaa"],
  [4, 9, "#ce9178"], [2, 6, "#6a9955"], [2, 11, "#9cdcfe"], [0, 2, "#d4d4d4"], [0, 8, "#c586c0"], [2, 14, "#dcdcaa"],
];

function drawScreen(ctx: Ctx, sky: Sky, time: number) {
  const { x, y, w, h } = MON;
  const left = x + 1.1;
  const top = y + 1.1;
  const right = x + w - 1.1;
  const bottom = y + h - 2.3;
  rect(ctx, left, top, right - left, bottom - top, "#1b1e23");
  rect(ctx, left, top, right - left, 1.6, "#25292f");
  rect(ctx, left + 1, top + 0.5, 6, 0.7, "#3c4148");
  rect(ctx, left, top + 1.6, 4.2, bottom - top - 3, "#202429");
  for (let r = 0; r < 4; r++) rect(ctx, left + 1.2, top + 3 + r * 3, 1.8, 1.8, r === 0 ? "#00979d" : "#4a5058");

  const scroll = Math.floor(time * 1.5);
  for (let r = 0; r < 9; r++) {
    const [indent, len, color] = CODE[(r + scroll) % CODE.length];
    const ly = top + 2.6 + r * 2.1;
    rect(ctx, left + 5, ly, 1.4, 0.8, "#5a6270");
    rect(ctx, left + 7.4 + indent, ly, len, 0.8, color);
  }
  if (time % 1 < 0.55) rect(ctx, left + 7.4 + CODE[(8 + scroll) % CODE.length][0] + CODE[(8 + scroll) % CODE.length][1] + 0.4, top + 2.4 + 8 * 2.1, 0.5, 1.2, "#e8e8e8");

  // the plotter: a faint grid and the sensor's trace running across
  const px = left + 27.6;
  rect(ctx, px - 0.6, top + 1.6, 0.4, bottom - top - 3, "#2c3138");
  rect(ctx, px, top + 1.6, right - px, bottom - top - 3, "#15181c");
  ctx.fillStyle = "rgba(120,130,145,0.18)";
  for (let gy = top + 4; gy < bottom - 1.6; gy += 4) ctx.fillRect(px, gy, right - px, 0.25);
  ctx.strokeStyle = "#4fc1ff";
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  for (let i = 0; i <= 34; i++) {
    const sx = px + 0.4 + i * ((right - px - 0.8) / 34);
    const phase = i * 0.42 - time * 2.4;
    const sy = top + 11 + Math.sin(phase) * 4.2 + Math.sin(phase * 2.7 + 1) * 1.1 + (hash(i + Math.floor(time * 6)) - 0.5) * 0.5;
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.stroke();
  rect(ctx, left, bottom - 1.4, right - left, 1.4, "#00979d");

  // by day the glass catches the room
  const day = 1 - sky.night;
  if (day > 0.05) {
    const sheen = ctx.createLinearGradient(left, top, right, bottom);
    sheen.addColorStop(0, `rgba(255,255,255,${(0.1 * day).toFixed(3)})`);
    sheen.addColorStop(0.5, `rgba(255,255,255,${(0.02 * day).toFixed(3)})`);
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(left, top, right - left, bottom - top);
  }
}

function sevenSeg(ctx: Ctx, text: string, x: number, y: number, size: number, color: string) {
  ctx.fillStyle = color;
  ctx.font = `700 ${size}px ui-monospace, monospace`;
  ctx.textBaseline = "top";
  ctx.fillText(text, x, y);
}

function drawReadouts(ctx: Ctx, sky: Sky, time: number) {
  const tick = Math.floor(time * 2);
  // the station holds its set point give or take a degree
  const temp = 350 + Math.round((hash(tick) - 0.5) * 2.4);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, 101.3, 83.9, 6, hex("#ff4a2a"), 0.35 + 0.35 * sky.night);
  ctx.restore();
  sevenSeg(ctx, String(temp), 97.7, 82.2, 3.6, "#ff5a36");

  // the meter reads the 5 V rail, its last digit wandering; an LCD has no light of its own
  const volts = (4.97 + Math.floor(hash(tick * 1.7) * 3) / 100).toFixed(2);
  const ambient = Math.max(0.25, sky.level + lamplight(sky) * 0.6);
  sevenSeg(ctx, volts, 157.4, 90.2, 2.6, rgba([28, 32, 26], Math.min(1, 0.4 + ambient)));
}

function drawLeds(ctx: Ctx, sky: Sky, time: number) {
  const boost = 0.55 + 0.45 * sky.night;
  const on = time % 1 < 0.5;
  const traffic = hash(Math.floor(time * 9)) > 0.5;
  const uno = (u: number) => 84.8 + u * 12;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  glow(ctx, 44.8, uno(0.4), 3.5, hex("#58ff8a"), 0.45 * boost);
  if (on) glow(ctx, 28.4, uno(0.4), 4, hex("#ffae3a"), 0.55 * boost);
  if (traffic) glow(ctx, 28.4, uno(0.5), 2.6, hex("#ffd04a"), 0.35 * boost);
  // the red LED on the breadboard follows pin 13, as the sketch says
  if (on) {
    glow(ctx, 72.7, 87.8, 9, hex("#ff3a2a"), 0.6 * boost);
    pool(ctx, 72.7, 91, 9, 3, hex("#ff3a2a"), 0.25 * boost);
  }
  if (time % 2 < 0.25) glow(ctx, 70, 78.5, 3.4, hex("#4ab0ff"), 0.7 * boost);
  ctx.restore();
  rect(ctx, 44.2, uno(0.38), 1.2, 0.7, "#7dffa6");
  rect(ctx, 27.8, uno(0.38), 1.2, 0.7, on ? "#ffd27a" : "#6a4a1e");
  rect(ctx, 27.8, uno(0.48), 1.2, 0.7, traffic ? "#ffe9a0" : "#5a4e2a");
  round(ctx, 71.9, 86.4, 1.6, 1.8, 0.8, on ? "#ff7a64" : "#9a2a22");
  if (time % 2 < 0.25) rect(ctx, 69.4, 78, 1.2, 0.8, "#bfe4ff");
}

function drawSmoke(ctx: Ctx, time: number) {
  // a thin rosin wisp from the iron's tip, and steam off the coffee
  for (let i = 0; i < 12; i++) {
    const p = (time * 0.22 + i / 12) % 1;
    const sx = 118.2 + Math.sin(p * 7 + i * 1.1) * (0.6 + p * 4) + p * 3;
    const sy = 90.6 - p * 26;
    ctx.fillStyle = `rgba(226,228,234,${((1 - p) * (1 - p) * 0.28).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 0.7 + p * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 7; i++) {
    const p = (time * 0.15 + i / 7) % 1;
    const sx = 180.2 + Math.sin(p * 5 + i * 2.3) * (0.8 + p * 2.4);
    const sy = 88 - p * 14;
    ctx.fillStyle = `rgba(240,240,244,${((1 - p) * p * 0.3).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 0.9 + p * 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawClouds(ctx: Ctx, sky: Sky, time: number) {
  const alpha = (1 - sky.night * 0.85) * 0.8;
  if (alpha <= 0.02) return;
  const { x, y, w } = WIN;
  const lit = mix([255, 255, 255], sky.bottom, 0.35 + sky.night * 0.3);
  const shade = mix(lit, sky.mid, 0.5);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, HORIZON - y);
  ctx.clip();
  const clouds: [number, number, number, number][] = [[0.1, 12, 1, 1.2], [0.5, 24, 0.7, 0.8], [0.82, 8, 0.8, 1]];
  for (const [phase, cy, size, speed] of clouds) {
    const cx = x - 24 + ((phase * (w + 48) + time * speed * 1.2) % (w + 48));
    // a flat, shaded base and a lit, lumpy top, as cumulus have
    for (const [dx, dy, r] of [[0, 1, 5], [7, 0.5, 6], [14, 1, 5], [5, -2, 4.5], [10, -2.6, 4.2]] as const) {
      ellipse(ctx, cx + dx * size, y + cy + dy * size, r * size * 1.4, r * size * 0.7, rgba(shade, alpha));
    }
    for (const [dx, dy, r] of [[2, -1.4, 4], [8, -2.6, 4.6], [12.5, -1, 3.6]] as const) {
      ellipse(ctx, cx + dx * size, y + cy + dy * size, r * size * 1.3, r * size * 0.6, rgba(lit, alpha));
    }
  }
  ctx.restore();
}

function drawStars(ctx: Ctx, sky: Sky, time: number) {
  const stars = smooth(0.68, 0.95, sky.t);
  if (stars <= 0) return;
  const { x, y, w } = WIN;
  for (let i = 0; i < 40; i++) {
    const sx = x + 2 + ((i * 37 + 11) % (w - 4));
    const sy = y + 2 + ((i * 53 + 5) % (HORIZON - y - 8));
    const twinkle = 0.5 + 0.5 * Math.sin(time * (1 + (i % 4) * 0.5) + i * 1.7);
    ctx.fillStyle = `rgba(255,255,255,${(stars * (0.25 + 0.5 * twinkle)).toFixed(2)})`;
    const size = i % 7 === 0 ? 0.9 : 0.55;
    ctx.fillRect(sx, sy, size, size);
  }
}

export type Scene = { draw: (ctx: Ctx, t: number, time: number) => void };

/** Allocates the cached layers once; `draw` repaints the full frame into `ctx` (SCENE_W*2 by SCENE_H*2 pixels). */
export function createScene(): Scene | null {
  const skyLayer = newLayer();
  const landLayer = newLayer();
  const roomLayer = newLayer();
  const lightLayer = newLayer();
  const bloomLayer = newLayer();
  if (!skyLayer.ctx || !landLayer.ctx || !roomLayer.ctx || !lightLayer.ctx || !bloomLayer.ctx) return null;
  let builtFor = -1;
  let sky = skyAt(0);

  const rebuild = (t: number) => {
    sky = skyAt(t);
    const light: Light = { sun: sunlight(sky), lamp: lamplight(sky), sunAt: sunPosition(sky.t) };
    for (const layer of [skyLayer, landLayer, roomLayer, lightLayer, bloomLayer]) layer.ctx?.clearRect(0, 0, SCENE_W, SCENE_H);
    drawSky(skyLayer.ctx!, sky);
    drawLandscape(landLayer.ctx!, sky);
    drawRoom(roomLayer.ctx!, light, sky);
    drawIrradiance(lightLayer.ctx!, light, sky);
    drawBloom(bloomLayer.ctx!, light, sky);

    // the room as lit: its colours times the light on them. The light is cut to the room's shape first, so the
    // window stays open to the sky behind it.
    const lit = lightLayer.ctx!;
    lit.save();
    lit.setTransform(1, 0, 0, 1, 0, 0);
    lit.globalCompositeOperation = "destination-in";
    lit.drawImage(roomLayer.canvas, 0, 0);
    lit.restore();
    const room = roomLayer.ctx!;
    room.save();
    room.setTransform(1, 0, 0, 1, 0, 0);
    room.globalCompositeOperation = "multiply";
    room.drawImage(lightLayer.canvas, 0, 0);
    room.restore();
    builtFor = t;
  };

  return {
    draw(ctx, t, time) {
      if (Math.abs(t - builtFor) > 0.0005) rebuild(t);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(skyLayer.canvas, 0, 0);
      ctx.restore();
      ctx.save();
      ctx.scale(SCALE, SCALE);
      drawStars(ctx, sky, time);
      drawClouds(ctx, sky, time);
      ctx.restore();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(landLayer.canvas, 0, 0);
      ctx.drawImage(roomLayer.canvas, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(bloomLayer.canvas, 0, 0);
      ctx.restore();
      ctx.save();
      ctx.scale(SCALE, SCALE);
      drawScreen(ctx, sky, time);
      drawReadouts(ctx, sky, time);
      drawLeds(ctx, sky, time);
      drawSmoke(ctx, time);
      ctx.restore();
    },
  };
}
