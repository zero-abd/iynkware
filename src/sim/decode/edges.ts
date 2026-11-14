/** A recorded line: `v[i]` holds from `t[i]` (ns) until the next sample. */
export interface Wire {
  t: ArrayLike<number>;
  v: ArrayLike<number>;
}

export type Level = 0 | 1;

/** A line reduced to its changes. `level[0]` is the level at `t[0]`; every later entry differs from the one before. */
export interface Edges {
  t: number[];
  level: Level[];
}

const MIN_SWING_VOLTS = 0.5;

/**
 * The level that separates high from low: halfway between the extremes, so a 3.3 V and a 5 V line both decode.
 * A line that never moves further than `MIN_SWING_VOLTS` is a steady level, read against half a volt like a digital probe.
 */
export function thresholdOf(wire: Wire): number {
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < wire.v.length; i++) {
    low = Math.min(low, wire.v[i]);
    high = Math.max(high, wire.v[i]);
  }
  return high - low >= MIN_SWING_VOLTS ? (low + high) / 2 : MIN_SWING_VOLTS;
}

export function toEdges(wire: Wire, threshold = thresholdOf(wire)): Edges {
  const edges: Edges = { t: [], level: [] };
  for (let i = 0; i < wire.t.length; i++) {
    const level: Level = wire.v[i] >= threshold ? 1 : 0;
    if (edges.level.length > 0 && edges.level[edges.level.length - 1] === level) continue;
    edges.t.push(wire.t[i]);
    edges.level.push(level);
  }
  return edges;
}

/** The level at `tNs`; before the first sample the line is taken to sit at its first level. */
export function levelAt(edges: Edges, tNs: number): Level {
  let lo = 0;
  let hi = edges.t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edges.t[mid] <= tNs) lo = mid + 1;
    else hi = mid;
  }
  return edges.level[Math.max(0, lo - 1)] ?? 1;
}

export type Annotation = {
  startNs: number;
  endNs: number;
  /** The signal the mark belongs to, so a view can give each its own row. */
  lane: string;
} & (
  | { kind: "data"; value: number; label: string; error?: "framing" | "parity" }
  | { kind: "address"; value: number; label: string; write: boolean }
  | { kind: "start" | "stop" | "ack" | "nack" }
);
