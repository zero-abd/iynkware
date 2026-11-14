import type { ArtElement, LodLevel } from "../engine/types.ts";

/*
 * Parts with no figure page, drawn by hand in the part frame (origin top-left, mm, y down) at the closest zoom.
 * Each drawing sits on the pin dots the canvas lays out for the part (src/parts/fallback.ts): those run along the
 * bottom edge from the left corner, so a lead or pad here ends at x = pin, y = body height.
 */

const INK = "var(--studio-ink)";
const PAPER = "var(--studio-paper)";
const BLACK = "var(--color-ink-fixed)";
const METAL = "var(--color-metal-m)";
const METAL_LIGHT = "var(--color-metal-l)";
const METAL_DARK = "var(--color-metal-d)";
const GOLD = "var(--color-mustard-m)";
const RED = "var(--color-tomato-m)";
const GREEN = "var(--color-mint-m)";
const BLUE = "var(--color-cobalt-m)";
const YELLOW = "var(--color-mustard-l)";
const PITCH = 2.54;

const round = (n: number): number => Math.round(n * 1000) / 1000;

const rect = (x: number, y: number, w: number, h: number, fill: string, rx = 0.2, stroke = INK, sw = 0.15): ArtElement => ({ t: "rect", x: round(x), y: round(y), w: round(w), h: round(h), rx, fill, stroke, sw });
const dot = (cx: number, cy: number, r: number, fill: string, stroke = INK, sw = 0.1): ArtElement => ({ t: "circle", cx: round(cx), cy: round(cy), r, fill, stroke, sw });
const line = (x1: number, y1: number, x2: number, y2: number, stroke: string, sw: number): ArtElement => ({ t: "path", d: `M${round(x1)} ${round(y1)}L${round(x2)} ${round(y2)}`, stroke, sw });
const label = (x: number, y: number, s: string, size: number, fill?: string): ArtElement => ({ t: "text", x: round(x), y: round(y), s, size, anchor: "middle", ...(fill && { fill }) });

/** GY-BME280 breakout, 11.5 x 15 mm: six pads down the left edge, the sensor's metal can on the right. */
function bme280(): ArtElement[] {
  const pads = ["VCC", "GND", "SCL", "SDA", "CSB", "SDO"];
  // the last pad sits on the bottom edge of the body, so the board runs a pad's width past it
  const art: ArtElement[] = [rect(0, 0, 11.5, 16.2, "#3c4f9e", 0.6, "#26357a", 0.25)];
  pads.forEach((name, i) => {
    const y = 15 - (12.7 - i * PITCH);
    art.push(dot(1.27, y, 0.75, GOLD, "#8a6a1c", 0.12), dot(1.27, y, 0.35, BLACK, BLACK, 0.05), label(3.6, y + 0.35, name, 0.9, PAPER));
  });
  art.push(
    dot(9.4, 1.7, 0.9, PAPER, "#26357a", 0.15),
    rect(6.2, 5.6, 3.4, 3.4, METAL_LIGHT, 0.3, METAL_DARK, 0.15),
    rect(6.6, 6, 2.6, 2.6, METAL, 0.2, METAL_DARK, 0.08),
    dot(8.6, 6.6, 0.25, BLACK, BLACK, 0.05),
    rect(6.4, 10.8, 1.2, 0.7, "#2a2a2a", 0.1),
    rect(8.4, 10.8, 1.2, 0.7, "#2a2a2a", 0.1),
    rect(6.4, 12.4, 3.2, 1.2, "#202020", 0.15),
    label(7.9, 3.9, "BME280", 1, PAPER),
  );
  return art;
}

/** A 15 mm steel ball in its housing, from above, on a two-hole mounting plate. */
function caster(): ArtElement[] {
  return [
    { t: "path", d: "M2 6L6 2L14 2L18 6L18 14L14 18L6 18L2 14Z", fill: METAL_LIGHT, stroke: INK, sw: 0.3 },
    dot(4.2, 10, 1.3, PAPER, INK, 0.25),
    dot(15.8, 10, 1.3, PAPER, INK, 0.25),
    dot(10, 10, 6, METAL, INK, 0.3),
    dot(10, 10, 4.6, METAL_DARK, INK, 0.2),
    dot(10, 10, 3.6, "#b9c0c3", METAL_DARK, 0.15),
    dot(8.8, 8.8, 1.2, "#f4f6f6", "#f4f6f6", 0.05),
  ];
}

/** A 2WD robot deck, 200 x 130 mm acrylic: motor slots at the back, the caster hole at the front, a grid of holes. */
function chassis(): ArtElement[] {
  const art: ArtElement[] = [
    { t: "path", d: "M24 2L176 2Q198 2 198 24L198 106Q198 128 176 128L24 128Q2 128 2 106L2 24Q2 2 24 2Z", fill: "#dfe9ec", stroke: INK, sw: 0.8 },
    rect(30, 6, 34, 14, PAPER, 2, INK, 0.6),
    rect(30, 110, 34, 14, PAPER, 2, INK, 0.6),
    dot(170, 65, 9, PAPER, INK, 0.6),
    rect(84, 40, 60, 50, "#cfdde1", 4, METAL_DARK, 0.5),
  ];
  for (let x = 92; x <= 136; x += 11) for (const y of [30, 100]) art.push(dot(x, y, 1.6, PAPER, INK, 0.35));
  for (const y of [34, 50, 80, 96]) for (const x of [20, 158, 182]) art.push(dot(x, y, 1.6, PAPER, INK, 0.35));
  for (const [x, y] of [[76, 13], [76, 117], [18, 13], [18, 117]] as const) art.push(dot(x, y, 2.2, PAPER, INK, 0.4));
  return art;
}

/** A bench signal source: a small black box with a sine on its face and its red and black leads. */
function signalSource(): ArtElement[] {
  return [
    line(0, 3.6, 0, 5, RED, 0.6),
    line(5.08, 3.6, 5.08, 5, BLACK, 0.6),
    rect(-0.6, 0, 10.6, 3.7, "#2a2a2a", 0.5, INK, 0.2),
    rect(0.4, 0.5, 5.6, 2.7, "#1d3b34", 0.3, BLACK, 0.1),
    { t: "path", d: "M0.8 1.85L1.5 1.05L2.2 1.05L2.9 1.85L3.6 2.65L4.3 2.65L5 1.85L5.6 1.25", stroke: "var(--color-mint-l)", sw: 0.2 },
    dot(7.6, 1.85, 1, METAL, INK, 0.15),
    line(7.6, 1.85, 7.6, 1.05, BLACK, 0.2),
    dot(0, 3.7, 0.45, RED, INK, 0.1),
    dot(5.08, 3.7, 0.45, BLACK, INK, 0.1),
  ];
}

/** A mini SPDT slide switch from the front: the metal case, the black slider on top, three legs on the 2.54 mm grid. */
function slideSwitch(): ArtElement[] {
  const h = 10.16;
  return [
    ...[0, PITCH, 2 * PITCH].map((x) => rect(x - 0.35, 7.6, 0.7, h - 7.6, METAL, 0.1, METAL_DARK, 0.08)),
    rect(-1.76, 3.6, 8.6, 4.2, METAL_LIGHT, 0.3, INK, 0.2),
    rect(-1.3, 4.1, 7.7, 3.2, METAL, 0.2, METAL_DARK, 0.1),
    rect(1.2, 1.4, 2.4, 2.4, BLACK, 0.3, INK, 0.15),
    line(1.7, 1.9, 3.1, 1.9, "#555", 0.15),
    line(1.7, 2.6, 3.1, 2.6, "#555", 0.15),
    dot(-0.9, 5.7, 0.35, PAPER, METAL_DARK, 0.08),
    dot(5.98, 5.7, 0.35, PAPER, METAL_DARK, 0.08),
  ];
}

/** A 65 mm TT-motor wheel from above: the tread across the tyre and the yellow hub with its D-shaft hole. */
function wheel(): ArtElement[] {
  const art: ArtElement[] = [rect(0, 1, 65, 24, "#2b2b2b", 8, INK, 0.4)];
  for (let x = 6; x <= 59; x += 4.5) art.push(line(x, 3, x + 1.6, 23, "#4a4a4a", 0.8));
  art.push(rect(21, 8.5, 23, 9, YELLOW, 1.2, INK, 0.3), dot(32.5, 13, 2.6, GOLD, INK, 0.25), rect(31.3, 11.8, 2.4, 2.4, BLACK, 0.2, BLACK, 0.05));
  return art;
}

/** An Interlink FSR 402 as it lies on a bench: the round sensing pad, its tail and the two crimp pins. */
function fsr402(): ArtElement[] {
  return [
    line(0, 1.7, 0, 2.54, METAL, 0.45),
    line(PITCH, 1.7, PITCH, 2.54, METAL, 0.45),
    rect(-0.6, 1.15, 3.74, 0.7, BLACK, 0.15, INK, 0.1),
    rect(1.27, 0.65, 2.3, 0.5, "#d9cfa8", 0.1, INK, 0.08),
    dot(3.95, 0.9, 1.15, "#d9cfa8", INK, 0.12),
    dot(3.95, 0.9, 0.85, "#3b3b3b", BLACK, 0.05),
    { t: "path", d: "M3.35 0.9L4.55 0.9M3.95 0.3L3.95 1.5M3.53 0.48L4.37 1.32M3.53 1.32L4.37 0.48", stroke: "#6a6a6a", sw: 0.08 },
  ];
}

/** A diffused 5 mm common-cathode RGB LED: the dome over four legs, red, common (the long one), green and blue. */
function rgbLed(): ArtElement[] {
  const h = 5.08;
  const legs: [number, string][] = [[0, RED], [PITCH, METAL], [2 * PITCH, GREEN], [3 * PITCH, BLUE]];
  return [
    // the legs leave the flange 1.27 mm apart and bend out to the 2.54 mm grid
    ...legs.map(([x, colour], i): ArtElement => ({ t: "path", d: `M${round(1.9 + i * 1.27)} 3.3L${round(1.9 + i * 1.27)} 3.7L${round(x)} 4.4L${round(x)} ${h}`, stroke: colour, sw: 0.4 })),
    rect(1.06, 2.7, 5.5, 0.7, "#e9e4dc", 0.15, INK, 0.12),
    { t: "path", d: "M1.36 2.8L1.36 1.5Q1.36 -0.6 3.81 -0.6Q6.26 -0.6 6.26 1.5L6.26 2.8Z", fill: "#f1ece4", stroke: INK, sw: 0.15 },
    dot(2.9, 1.3, 0.35, RED, RED, 0.05),
    dot(3.81, 1.7, 0.35, GREEN, GREEN, 0.05),
    dot(4.7, 1.3, 0.35, BLUE, BLUE, 0.05),
  ];
}

const DRAW: Readonly<Record<string, () => ArtElement[]>> = {
  "core.bme280-module": bme280,
  "core.caster-ball": caster,
  "core.chassis-2wd": chassis,
  "core.signal-source": signalSource,
  "core.slide-switch": slideSwitch,
  "core.wheel-65": wheel,
  "core.fsr402": fsr402,
  "core.rgb-led": rgbLed,
};

/** The hand drawing of a part at the closest zoom, or null when the part has none. */
export function partArt(defRef: string, lod: LodLevel): readonly ArtElement[] | null {
  return lod === 2 ? (DRAW[defRef]?.() ?? null) : null;
}
