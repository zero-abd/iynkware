import type { ArtElement, LodLevel } from "../engine/types.ts";

const INK = "var(--studio-ink)";
const METAL = "var(--color-metal-m)";
const METAL_LIGHT = "var(--color-metal-l)";
const METAL_DARK = "var(--color-metal-d)";
const BLACK = "var(--color-ink-fixed)";
const MASK = "#0c7c86";
const MASK_EDGE = "#075d65";
const SW = 0.2;
const HEADER_MM = 2.54;

const round = (n: number): number => Math.round(n * 1000) / 1000;

/*
 * Both boards are drawn from above in the part frame (origin top-left, mm, y down). The Eagle coordinates in
 * docs/facts/uno-r3.md and nano.md are bottom-left with y up, so every y goes through `up`.
 */
type Frame = (y: number) => number;
const frameOf = (height: number): Frame => (y) => round(height - y);

const rect = (x: number, y: number, w: number, h: number, fill: string, rx = 0.3, stroke = INK): ArtElement => ({ t: "rect", x: round(x), y: round(y), w, h, rx, fill, stroke, sw: SW });
const dot = (cx: number, cy: number, r: number, fill: string): ArtElement => ({ t: "circle", cx: round(cx), cy: round(cy), r, fill, stroke: INK, sw: 0.1 });
const label = (x: number, y: number, s: string, size = 1.3, anchor: "start" | "middle" | "end" = "middle"): ArtElement => ({ t: "text", x: round(x), y: round(y), s, size, anchor });

/** A row of `count` female header sockets, pin one at `x`, running toward -x; `y` is the row centre. */
function socketRow(x: number, y: number, count: number): ArtElement {
  return rect(x - (count - 1) * HEADER_MM - HEADER_MM / 2, y - HEADER_MM / 2, count * HEADER_MM, HEADER_MM, BLACK, 0.2);
}

function unoArt(lod: LodLevel): ArtElement[] {
  const up = frameOf(53.34);
  const outline = [
    `M 1 ${up(0)}`,
    `L 65.04 ${up(0)} A 1 1 0 0 0 66.04 ${up(1)}`,
    `L 66.04 ${up(2.54)} L 68.58 ${up(5.08)} L 68.58 ${up(37.846)} L 66.04 ${up(40.386)} L 66.04 ${up(51.816)} L 64.516 ${up(53.34)}`,
    `L 1 ${up(53.34)} A 1 1 0 0 0 0 ${up(52.34)}`,
    `L 0 ${up(1)} A 1 1 0 0 0 1 ${up(0)} Z`,
  ].join(" ");
  const art: ArtElement[] = [{ t: "path", d: outline, fill: MASK, stroke: MASK_EDGE, sw: 0.4 }];
  if (lod === 0) return art;

  art.push(
    rect(-6.47, up(45.86), 16.01, 15.52, METAL_LIGHT, 0.5),
    rect(-1.87, up(12.36), 15.55, 11.06, BLACK, 0.5),
    socketRow(63.5, up(50.8), 8),
    socketRow(41.656, up(50.8), 10),
    socketRow(27.94 + 7 * HEADER_MM, up(2.54), 8),
    socketRow(50.8 + 5 * HEADER_MM, up(2.54), 6),
    rect(28.6, up(21.4), 35.6, 10.2, BLACK, 0.4),
  );
  if (lod === 1) return art;

  for (const [x, y] of [[13.97, 2.54], [15.24, 50.8], [66.04, 7.62], [66.04, 35.56]] as const) art.push(dot(x, up(y), 1.6, "var(--studio-paper)"));
  art.push(
    rect(-6.47 + 1.2, up(45.86) + 1.2, 13.6, 13.1, METAL, 0.4, METAL_DARK),
    rect(1.6, up(11.2), 9, 8.8, "#2c2c2c", 0.4),
    rect(2.6, up(7.8), 6, 1.6, METAL_DARK, 0.2),
    rect(32.55, up(20.1), 27.6, 7.8, "#242424", 0.6),
    { t: "path", d: `M ${62.1} ${up(13.4)} A 1.1 1.1 0 0 1 ${62.1} ${up(16.6)}`, stroke: METAL, sw: SW },
    rect(17.1, up(37.5), 5.6, 5.6, "#262626", 0.4),
    rect(15.4, up(28.5), 7.1, 4.7, METAL_LIGHT, 2),
    rect(39.6, up(25.9), 3.4, 2, "#5a5a52", 0.3),
    rect(1.35, up(52.35), 10, 5.9, METAL_LIGHT, 0.8),
    dot(6.35, up(49.4), 1.9, "#f4f4ee"),
    rect(4.5, up(20.6), 6.8, 6.8, "#242424", 0.3),
    dot(25.527, up(9.144), 2.9, METAL),
    dot(18.415, up(9.144), 2.9, METAL),
    rect(62.357, up(31.75), 5.08, 7.62, BLACK, 0.2),
    rect(14.478, up(48.768), 7.62, 5.08, BLACK, 0.2),
  );
  art.push(
    label(40.64, up(34.29), "UNO", 3.2),
    label(40.64, up(38.1), "ARDUINO", 2.4),
    label(40, up(44.6), "DIGITAL (PWM ~)", 1.4),
    label(53, up(5.9), "ANALOG IN", 1.4),
    label(33, up(5.9), "POWER", 1.4),
  );
  for (let i = 0; i < 6; i++) art.push(label(50.8 + i * HEADER_MM, up(4.2), `A${i}`, 1));
  for (const [i, name] of ["IOREF", "RESET", "3V3", "5V", "GND", "GND", "VIN"].entries()) art.push(label(30.48 + i * HEADER_MM, up(4.2), name, 0.9));
  for (let i = 0; i < 8; i++) art.push(label(63.5 - i * HEADER_MM, up(47.9), String(i), 1));
  for (let i = 0; i < 6; i++) art.push(label(41.656 - i * HEADER_MM, up(47.9), String(8 + i), 1));
  return art;
}

function nanoArt(lod: LodLevel): ArtElement[] {
  const up = frameOf(17.78);
  const art: ArtElement[] = [rect(0, 0, 43.18, 17.78, MASK, 0, MASK_EDGE)];
  if (lod === 0) return art;
  art.push(rect(-2.1, up(12.79), 9.2, 7.8, METAL_LIGHT, 0.5), rect(2.54, 0, 38.1, 2.54, BLACK, 0.2), rect(2.54, 15.24, 38.1, 2.54, BLACK, 0.2));
  if (lod === 1) return art;
  art.push(
    ...[[1.27, 1.27], [41.91, 1.27], [1.27, 16.51], [41.91, 16.51]].map(([x, y]) => dot(x!, up(y!), 0.9, "var(--studio-paper)")),
    rect(5.28, up(11.51), 10.2, 5.3, "#2a2a2a", 0.3),
    { t: "path", d: `M ${15.49} ${up(12.34)} L ${18.99} ${up(8.84)} L ${15.49} ${up(5.34)} L ${11.99} ${up(8.84)} Z`, fill: "#222", stroke: INK, sw: SW },
    rect(23.26, up(10.39), 2.5, 3, METAL_LIGHT, 0.3),
    rect(19.25, up(13.86), 3.2, 1.3, "#5a5a52", 0.3),
    ...[14.05, 11.25, 8.53, 4.83].map((y, i) => rect(30.8, up(y) - 0.4, 0.8, 0.8, ["#cf5038", "#71b693", "#f4b829", "#76a0e2"][i]!, 0.1)),
    ...[6.35, 8.89, 11.43].flatMap((y) => [41.81, 39.27].map((x) => dot(x, up(y), 0.7, "var(--color-metal-d)"))),
    label(35.5, up(9.4), "NANO", 1.8),
    label(7, up(9.4), "USB", 1.2),
  );
  return art;
}

const DRAW: Readonly<Record<string, (lod: LodLevel) => ArtElement[]>> = { "core.uno-r3": unoArt, "core.nano": nanoArt };

/** The top-down drawing of the boards the Studio draws by hand, or null for any other part. */
export function boardArt(defRef: string, lod: LodLevel): readonly ArtElement[] | null {
  return DRAW[defRef]?.(lod) ?? null;
}
