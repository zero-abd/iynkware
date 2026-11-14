/**
 * iynk's colours, as the figures and the 2D site use them. Every colour the headset draws comes from here: the paper
 * and ink, the flat blue shadow, the five figure palettes and the engine's materials (three tone bands each), the
 * spatial UI tokens of docs/XR_DESIGN.md 9.3, wires, LEDs and states.
 *
 * Sources: figures/vendor/colorfigures/core.js (PALS, METAL, CLEAR, CERAMIC, DARK, INK, SHADOW, the callout tag),
 * figures/engine/bench.js (M, WIRE, the cutting mat and its grid), src/styles/tokens.css (chrome and states).
 *
 *   import { INK, PAPER, BANDS, bandsOf } from '../look/palette';
 *   const mat = BANDS.mat;            // { l, m, d }: light, mid and dark band of the cutting mat
 *   const own = bandsOf('#2f6fd8');   // any colour as three bands, the figures' matOf rule
 */

/** Three flat tone bands of one material: light (lit faces), mid, dark (faces turned from the light). '#rrggbb'. */
export interface Bands {
  readonly l: string;
  readonly m: string;
  readonly d: string;
}

/* ---------- paper, ink, shadow ---------- */
/** All text that must be read, every outline and leader line. */
export const INK = '#231e16';
/** Figure plates, panels, chips, the mat's paper. */
export const PAPER = '#f2efe7';
/** Paper in a dim room (the 2D dark theme's plate). Ink stays. */
export const PAPER_DIM = '#e4ddcf';
/** The flat cast shadow under everything, the figures' #41538f. */
export const SHADOW = '#41538f';
/** Units and decoration only (3.5:1 on paper). */
export const MUTED = '#857d6e';
export const MUTED_DIM = '#6a6357';
/** Dividers, the mat grid on paper. */
export const RULE = '#ddd6c8';
export const RULE_DIM = '#cbc2b1';
/** Hover, targets, primary fill (UI). Never a text colour: ink on accent is 5:1. */
export const ACCENT = '#e4694e';
/** The figures' own accent: a part that is on or picked, a callout that is lit (core.js `--accent`). */
export const FIGURE_ACCENT = '#f4b829';
/** The cream fill of a figure's callout tag (core.js). */
export const TAG = '#fff4d6';

/** State colours, 5.3 to 5.7:1 on paper. Always with an icon and a word, never alone. */
export const STATE = {
  good: '#1f6b4a',
  bad: '#a8402b',
  warn: '#7a5a00',
  info: '#1d4fd8',
} as const;
export type StateTone = keyof typeof STATE;

/** Burnt parts turn char; the outline stays (XR_DESIGN.md section 4). */
export const CHAR = '#2b2620';

/* ---------- bands ---------- */
/** core.js mix(a, b, t): per-channel blend of two '#rrggbb' colours in sRGB, rounded. */
export function mixHex(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  let out = '#';
  for (const i of [1, 3, 5]) out += Math.round(ch(a, i) * (1 - t) + ch(b, i) * t).toString(16).padStart(2, '0');
  return out;
}

/** core.js matOf: the mid band 16 % and the dark band 42 % of the way to black. */
export function bandsOf(hex: string): Bands {
  return { l: hex, m: mixHex(hex, '#000000', 0.16), d: mixHex(hex, '#000000', 0.42) };
}

/** The figure palettes and the engine's materials, each as three hand-picked bands. */
export const BANDS = {
  // the five Colorfigures palettes
  mustard: { l: '#f4b829', m: '#d49c1f', d: '#4e4a18' },
  tomato: { l: '#ef6a4c', m: '#cf5038', d: '#4a2219' },
  mint: { l: '#93d3b0', m: '#71b693', d: '#1f4034' },
  cobalt: { l: '#76a0e2', m: '#5a82c6', d: '#1c2948' },
  blush: { l: '#f3a6bb', m: '#d8869c', d: '#4b2430' },
  // core.js materials
  metal: { l: '#eef0f0', m: '#c6ccce', d: '#8f989b' },
  clear: { l: '#e4f2f4', m: '#c4dfe4', d: '#97b9c0' },
  ceramic: { l: '#fbfaf3', m: '#e3e0d2', d: '#bdb8a6' },
  dark: { l: '#55504a', m: '#3d3935', d: '#272421' },
  board: { l: '#e6e1d4', m: '#cfc8b8', d: '#aaa293' },
  wood: { l: '#d9a86c', m: '#bf8a4f', d: '#8e6236' },
  // bench.js materials
  gold: { l: '#f4d37c', m: '#d8b04f', d: '#8d6a24' },
  steel: { l: '#e9ecec', m: '#bcc3c5', d: '#7f888b' },
  blackPlastic: { l: '#5a5550', m: '#403c38', d: '#2a2725' },
  white: { l: '#fbf8ef', m: '#e7e2d3', d: '#c4bdab' },
  tan: { l: '#e3c79a', m: '#c9a874', d: '#8f7449' },
  fr4: { l: '#d9cf9a', m: '#bfb47c', d: '#8c8352' },
  copper: { l: '#f0a46b', m: '#d4834a', d: '#8f5226' },
  /** The cutting mat every bench figure stands on. */
  mat: { l: '#dfe3d2', m: '#c6cbb6', d: '#9da38c' },
  /** Paper as a solid (panel backs, the studio floor). */
  paper: { l: '#f2efe7', m: '#ddd6c8', d: '#b9b09e' },
} as const satisfies Record<string, Bands>;
export type BandName = keyof typeof BANDS;

/** The mat's 10 mm grid lines (bench.js drawMat: stroke #a9b096, width 0.5, opacity 0.7). */
export const MAT_GRID = '#a9b096';
/** A hole's dark, the silkscreen's white (bench.js). */
export const HOLE = '#2b2825';
export const SILK = '#f6f4ea';

/* ---------- wires, LEDs ---------- */
/** Jumper wire colours, the bench figures' WIRE (bench.js). Keys are the project document's wire colours. */
export const WIRE: Readonly<Record<string, string>> = {
  red: '#e2483d',
  black: '#3a3632',
  orange: '#f08a2b',
  yellow: '#f2c230',
  green: '#43b05c',
  blue: '#3e86d9',
  white: '#ece6d6',
  purple: '#8c4bd1',
  brown: '#8a5a34',
  grey: '#9a958c',
};
/** A wire whose colour the palette does not know. */
export const WIRE_FALLBACK = WIRE.orange!;

/** What a lit LED glows: its lens blends towards this and its halo is drawn in it. */
export const LED_GLOW: Readonly<Record<string, string>> = {
  red: '#ff4a2e',
  green: '#4fe27a',
  yellow: '#ffd23f',
  blue: '#4f8bff',
  white: '#fff6e0',
  orange: '#ff9a3a',
};

/* ---------- the room ---------- */
export type RoomLight = 'bright' | 'dim';

/** Chrome tokens for a bright or a dim room (XR_DESIGN.md 9.3). Ink never changes. */
export interface RoomTokens {
  readonly paper: string;
  readonly ink: string;
  readonly muted: string;
  readonly rule: string;
  readonly shadow: string;
  readonly accent: string;
}
export const ROOM: Readonly<Record<RoomLight, RoomTokens>> = {
  bright: { paper: PAPER, ink: INK, muted: MUTED, rule: RULE, shadow: SHADOW, accent: ACCENT },
  dim: { paper: PAPER_DIM, ink: INK, muted: MUTED_DIM, rule: RULE_DIM, shadow: SHADOW, accent: ACCENT },
};

/** The overlay's and the guide's tones (contracts/lesson.ts `Tone`) as fills on paper. */
export const TONE_FILL = {
  do: ACCENT,
  pass: '#b9dcc4',
  fail: '#f0b3a5',
  warn: '#f4d37c',
  info: TAG,
} as const;
/** Ink-legible state colours for icons and badges by tone. */
export const TONE_INK = {
  do: INK,
  pass: STATE.good,
  fail: STATE.bad,
  warn: STATE.warn,
  info: STATE.info,
} as const;

/** '#rrggbb' as a 0xrrggbb number, for three's Color. */
export const hexNum = (hex: string): number => parseInt(hex.slice(1), 16);
