/**
 * Where everything on the design panel sits. The panel stands on the bench's left (metres, origin the bench top
 * centre, +x right, +z towards the person, y up), turned towards the person. Sheet positions are metres from the
 * panel's top left, y down; `toPanel` makes them the panel group's x right, y up from its centre.
 */
export const PANEL = {
  /** The paper's size and thickness. */
  w: 0.42,
  h: 0.62,
  thick: 0.01,
  /** Centre on the bench (its foot is 12 mm over the top), turned 0.45 rad about y towards the person. */
  x: -0.4,
  y: 0.322,
  z: -0.12,
  yaw: 0.45,
  /** The distance its type is sized for. */
  distanceM: 0.62,
  margin: 0.015,
} as const;

export const SLOTS = ['batt', 'motor', 'prop'] as const;
export type Slot = (typeof SLOTS)[number];

/** Rows of the sheet, centres in metres from the top. */
export const ROWS = {
  title: 0.026,
  picks: [0.08, 0.13, 0.18],
  numbers: 0.2325,
  numberPitch: 0.0215,
  rule1: 0.313,
  checks: 0.318,
  checkBlock: 0.029,
  checkMax: 3,
  rule2: 0.41,
  rulesTitle: 0.422,
  rules: 0.44,
  rulePitch: 0.0132,
  ruleMax: 9,
  fly: 0.5925,
} as const;

/** x of the option plates' row (after the kicker column) and the plates' size. */
export const PICK = { left: 0.105, h: 0.04, maxW: 0.095, gap: 0.005 } as const;

export interface Cell {
  /** Centre, metres from the panel's top left. */
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
}

/** The plates of one pick row for `count` options: they share the width after the kicker, each at most `maxW`. */
export function pickRow(count: number, row: number): Cell[] {
  const avail = PANEL.w - PANEL.margin - PICK.left;
  const w = Math.min(PICK.maxW, (avail - PICK.gap * (count - 1)) / Math.max(1, count));
  return Array.from({ length: count }, (_, i) => ({ cx: PICK.left + w / 2 + i * (w + PICK.gap), cy: ROWS.picks[row]!, w }));
}

/** A sheet point as the panel group's own x (right) and y (up from the centre). */
export const toPanel = (cx: number, cy: number): { x: number; y: number } => ({ x: cx - PANEL.w / 2, y: PANEL.h / 2 - cy });

/** The Fly plate's size and its centre on the sheet. */
export const FLY = { w: 0.2, h: 0.045, cx: PANEL.w / 2, cy: ROWS.fly } as const;

/** A pick label as the option plate prints it: iynk's content label without the chemistry word that every pack shares. */
export const shortLabel = (label: string): string => label.replace(/\s+(LiPo|Li-ion)$/i, '');
