/**
 * The maths of acting on parts while the run is live: pure functions, no scene and no clock, tested in node. A gesture
 * becomes a number in the unit the part's descriptor takes (`pos` 0..1, `lux`, `distance` in centimetres, `temp_c`,
 * `moisture` in percent), and `inputsOf` reads from the descriptor which of these a part takes, never from a list of refs.
 */

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const smoothstep = (t: number): number => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

// ---- what a part takes (from its descriptor) ------------------------------------------------------------------

/** The part of a descriptor this file reads; the real `Descriptor` satisfies it. */
export interface DescriptorLike {
  readonly parameters?: ReadonlyArray<{ id: string; default?: unknown; min?: number; max?: number }>;
  readonly behaviour?: { readonly layers?: ReadonlyArray<{ model?: { kind?: string; element?: string } }> };
  readonly mechanics?: { readonly sensor?: { query?: string; beam_deg?: number; range_min_mm?: number; range_max_mm?: number } };
}

export type InputSpec =
  | { kind: 'button'; path: 'pressed' }
  | { kind: 'switch'; path: 'closed'; rest: number }
  | { kind: 'pot'; path: 'pos'; rest: number }
  | { kind: 'light'; path: 'lux'; rest: number; max: number }
  | { kind: 'temp'; path: 'temp_c'; rest: number; min: number; max: number }
  | { kind: 'moisture'; path: 'moisture'; rest: number }
  | { kind: 'humidity'; path: 'humidity'; rest: number }
  | { kind: 'distance'; path: 'distance'; beamDeg: number; minM: number; maxM: number };

/** What an unobstructed ranger reads at the start of a run (the engines' own default), centimetres. */
export const RANGER_REST_CM = 25;

const numberOr = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Every run-time input the descriptor offers, in a fixed order. */
export function inputsOf(d: DescriptorLike | undefined): InputSpec[] {
  const out: InputSpec[] = [];
  if (!d) return out;
  const param = (id: string) => d.parameters?.find((p) => p.id === id);
  if (d.behaviour?.layers?.some((l) => l.model?.kind === 'element' && l.model.element === 'button')) out.push({ kind: 'button', path: 'pressed' });
  const closed = param('closed');
  if (closed) out.push({ kind: 'switch', path: 'closed', rest: numberOr(closed.default, 0) });
  const pos = param('pos');
  if (pos) out.push({ kind: 'pot', path: 'pos', rest: numberOr(pos.default, 0.5) });
  const lux = param('lux');
  if (lux) out.push({ kind: 'light', path: 'lux', rest: numberOr(lux.default, 300), max: numberOr(lux.max, 100000) });
  const temp = param('temp_c');
  if (temp) out.push({ kind: 'temp', path: 'temp_c', rest: numberOr(temp.default, 22), min: numberOr(temp.min, -40), max: numberOr(temp.max, 125) });
  const wet = param('moisture');
  if (wet) out.push({ kind: 'moisture', path: 'moisture', rest: numberOr(wet.default, 40) });
  const hum = param('humidity');
  if (hum) out.push({ kind: 'humidity', path: 'humidity', rest: numberOr(hum.default, 45) });
  const s = d.mechanics?.sensor;
  if (s?.query === 'ray-fan') {
    out.push({
      kind: 'distance',
      path: 'distance',
      beamDeg: numberOr(s.beam_deg, 30),
      minM: numberOr(s.range_min_mm, 20) / 1000,
      maxM: numberOr(s.range_max_mm, 4000) / 1000,
    });
  }
  return out;
}

// ---- the knob ---------------------------------------------------------------------------------------------------

/** The knob's sweep for a wrist twist: 1:1 over 270 degrees of roll. */
export const KNOB_SWEEP_RAD = (270 * Math.PI) / 180;
/** A ray drag of this many metres sideways is the full range (XR_DESIGN 6.2). */
export const KNOB_DRAG_M = 0.15;

/** The signed angle (radians, -pi..pi) of a rotation `dq` (x, y, z, w) about the unit axis (ax, ay, az): its twist. */
export function twistAbout(qx: number, qy: number, qz: number, qw: number, ax: number, ay: number, az: number): number {
  const proj = qx * ax + qy * ay + qz * az;
  let a = 2 * Math.atan2(proj, qw);
  if (a > Math.PI) a -= 2 * Math.PI;
  else if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Wrist roll (positive: clockwise for the person) and a sideways drag, from where the turn began, as a knob position. */
export function knobPos(start: number, rollRad: number, dragM: number): number {
  return clamp01(start + rollRad / KNOB_SWEEP_RAD + dragM / KNOB_DRAG_M);
}

/** Whether a position change crossed a tenth, for the light haptic tick. */
export function crossedTenth(prev: number, next: number): boolean {
  return Math.floor(clamp01(prev) * 10 + 1e-9) !== Math.floor(clamp01(next) * 10 + 1e-9);
}

// ---- a hand above a light sensor ----------------------------------------------------------------------------------

/** A hand this close above the sensor (bench metres) starts to shade it. */
export const SHADE_REACH_M = 0.15;
/** Sideways, a hand shades the sensor out to this far (bench metres). */
export const SHADE_SIDE_M = 0.12;
/** At the surface a flat hand leaves this share of the light. */
export const SHADE_FLOOR = 0.02;

/** How much a hand at `height` above and `side` beside the sensor shades it, 0 (none) to 1 (as close as it gets). */
export function shadeAmount(height: number, side: number): number {
  if (height < -0.01 || height > SHADE_REACH_M) return 0;
  const up = 1 - clamp01(height / SHADE_REACH_M);
  const across = 1 - clamp01(side / SHADE_SIDE_M);
  return smoothstep(up) * smoothstep(across);
}

/** The light on the sensor: the room's at no shade, nearly dark at full shade. */
export function shadedLux(ambient: number, shade: number): number {
  return ambient * (1 - clamp01(shade) * (1 - SHADE_FLOOR));
}

// ---- a hand in front of a distance sensor -----------------------------------------------------------------------------

/** Whether a point at offset (x, y, z) from the sensor lies in front of it within a cone of `halfAngleRad`. `axis` is a unit vector. */
export function inCone(x: number, y: number, z: number, ax: number, ay: number, az: number, halfAngleRad: number): boolean {
  const len = Math.hypot(x, y, z);
  if (len < 1e-6) return false;
  return (x * ax + y * ay + z * az) / len >= Math.cos(halfAngleRad);
}

/** A bench distance as the real distance the sensor reports, in centimetres, clamped to the part's range; null past its far end. */
export function rangeCm(benchM: number, workScale: number, minM: number, maxM: number): number | null {
  const real = benchM / Math.max(1e-6, workScale);
  if (real > maxM) return null;
  return Math.round(clamp(real, minM, maxM) * 1000) / 10;
}

// ---- warmth, soil and breath ------------------------------------------------------------------------------------------

/** Body warmth, degrees Celsius. */
export const BODY_C = 34;
export const WARM_TAU_S = 3;
export const COOL_TAU_S = 8;

/** Moves `value` towards `target` as a first order lag with time constant `tau` seconds. */
export function approach(value: number, target: number, tau: number, dt: number): number {
  if (tau <= 0) return target;
  return target + (value - target) * Math.exp(-Math.max(0, dt) / tau);
}

/** A temperature sensor under a hand warms towards body warmth; released, it falls back to the room. */
export function warmStep(temp: number, held: boolean, room: number, dt: number): number {
  const target = Math.max(room, BODY_C);
  return held ? approach(temp, target, WARM_TAU_S, dt) : approach(temp, room, COOL_TAU_S, dt);
}

/** A press on Water adds this much moisture (percent). */
export const WATER_PERCENT = 35;
export const DRY_PER_S = 1.5;

export interface Soil {
  /** What the sensor shows, percent. */
  value: number;
  /** Where it is heading while it soaks in. */
  target: number;
}

export const wetSoil = (s: Soil): void => {
  s.target = Math.min(100, Math.max(s.target, s.value) + WATER_PERCENT);
};

/** Water soaks in over about a second, then the soil dries slowly towards its resting dampness. */
export function soilStep(s: Soil, rest: number, dt: number): void {
  s.value = approach(s.value, s.target, 0.4, dt);
  s.target = Math.max(rest, s.target - DRY_PER_S * dt);
  if (s.target <= rest && Math.abs(s.value - rest) < 0.05) s.value = rest;
}

/** A hand held close breathes on a humidity sensor: it rises quickly and falls back slowly. */
export function breathStep(h: number, near: boolean, rest: number, dt: number): number {
  return near ? approach(h, 95, 2.5, dt) : approach(h, rest, 6, dt);
}

// ---- sending -----------------------------------------------------------------------------------------------------------

/** At most 20 inputs a second (XR_DESIGN 6.2). */
export const SEND_MS = 50;

export interface Limiter {
  /** True when `value` differs from the last one sent by at least `eps` and `SEND_MS` have passed; then records it as sent. */
  take(value: number, nowMs: number): boolean;
  /** True, and recorded, when `value` is not the last one sent and `SEND_MS` have passed: the last value of a gesture. */
  settle(value: number, nowMs: number): boolean;
  /** Records a value as sent without checking (a final value after a gesture). */
  force(value: number, nowMs: number): void;
  readonly last: number | null;
  reset(): void;
}

export function limiter(eps: number, minMs: number = SEND_MS, initial: number | null = null): Limiter {
  let last: number | null = initial;
  let at = -Infinity;
  return {
    take(value, nowMs) {
      if (last !== null && Math.abs(value - last) < eps) return false;
      if (nowMs - at < minMs) return false;
      last = value;
      at = nowMs;
      return true;
    },
    settle(value, nowMs) {
      if (value === last || nowMs - at < minMs) return false;
      last = value;
      at = nowMs;
      return true;
    },
    force(value, nowMs) {
      last = value;
      at = nowMs;
    },
    get last() {
      return last;
    },
    reset() {
      last = initial;
      at = -Infinity;
    },
  };
}
