/**
 * Colour tokens and sizes of docs/XR_DESIGN.md section 9, for the run pillar. Pure data and maths (tested in node).
 *
 * Adapter: the spatial UI kit (#23, `xr/src/ui`) and the look kit (`xr/src/look`) will own these; switch to theirs
 * when they land and keep the names.
 */
import type { Tone } from '../../contracts/lesson';

/** Bright-room values (9.3). The dim room lowers `paper` and `rule` only. */
export const INK = {
  paper: '#f2efe7',
  paperDim: '#e4ddcf',
  ink: '#231e16',
  muted: '#857d6e',
  rule: '#ddd6c8',
  shadow: '#41538f',
  accent: '#e4694e',
  good: '#1f6b4a',
  bad: '#a8402b',
  warn: '#7a5a00',
  info: '#1d4fd8',
  /** A burnt part's bands (section 4). */
  char: '#2b2620',
} as const;

export type InkToken = keyof typeof INK;

/** The overlay's and the guide's tones (9.3). */
export const TONE: Readonly<Record<Tone, InkToken>> = { do: 'accent', pass: 'good', fail: 'bad', warn: 'warn', info: 'info' };

/** The comfortable viewing distance of the front rail, metres (2.1: touch UI at 0.42 to 0.48 m). */
export const RAIL_DISTANCE_M = 0.47;

/** Metres for a size in dmm (1 dmm = 1 mm per metre of viewing distance) seen from `distanceM`. */
export function dmm(size: number, distanceM: number = RAIL_DISTANCE_M): number {
  return (size * distanceM) / 1000;
}

/** Type sizes in dmm (9.2). */
export const TYPE = { display: 44, title: 30, body: 22, label: 20, code: 20, caption: 18 } as const;

/** `#rrggbb` to 0..1 channels. */
export function rgbOf(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * The figure's three bands of a colour: light, mid 16 % of the way to black, dark 42 % (docs/XR_ASSETS.md section 3,
 * `matOf` in the Colorfigures core).
 */
export function bandsOf(hex: string): { l: [number, number, number]; m: [number, number, number]; d: [number, number, number] } {
  const l = rgbOf(hex);
  const toward = (k: number) => l.map((c) => c * (1 - k)) as [number, number, number];
  return { l, m: toward(0.16), d: toward(0.42) };
}

/** Which band a face with this normal takes under the fixed light: light above 0.6, dark below 0.05 (`ink.fixed`). */
export function bandOf(normal: readonly [number, number, number], light: readonly [number, number, number] = FIXED_LIGHT): 'l' | 'm' | 'd' {
  const dot = normal[0] * light[0] + normal[1] * light[1] + normal[2] * light[2];
  return dot > 0.6 ? 'l' : dot < 0.05 ? 'd' : 'm';
}

/** Fixed light in the bench frame: from above, a little towards the person and to the right. Unit length. */
export const FIXED_LIGHT: readonly [number, number, number] = (() => {
  const v = [0.35, 1, 0.55];
  const n = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / n, v[1]! / n, v[2]! / n] as const;
})();
