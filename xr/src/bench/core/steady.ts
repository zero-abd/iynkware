/**
 * Steadying (design 3.4.6): a one-euro filter for a 3D point. While a ghost is shown the pinch pose passes through it
 * before it is projected onto the board; carrying without a ghost stays direct (call `reset()` when the ghost goes, so
 * the next one starts from the hand and not from where the last one was).
 *
 * The one-euro filter (Casiez, Roussel and Vogel, CHI 2012) is a low-pass filter whose cutoff rises with speed: slow
 * movement is smoothed hard (jitter goes), fast movement is followed closely (no lag). The speed is the length of the
 * filtered derivative, in the input's units per second, so one cutoff serves all three axes. Allocation-free: the
 * result is in `x`, `y`, `z`.
 */

export interface OneEuroOptions {
  /** Hz: the cutoff at rest. Lower is steadier and laggier. Design 3.4.6 start: 1.5. */
  readonly minCutoff?: number;
  /** How fast the cutoff rises with speed (per input unit per second). Design 3.4.6 start: 0.01. */
  readonly beta?: number;
  /** Hz: the cutoff of the derivative's own filter. */
  readonly dCutoff?: number;
}

export const ONE_EURO_DEFAULTS: Required<OneEuroOptions> = { minCutoff: 1.5, beta: 0.01, dCutoff: 1 };

export interface OneEuro3 {
  /** The filtered point after the last `filter` call. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Whether a sample has arrived since the last reset. */
  readonly primed: boolean;
  /** Feeds one sample taken at `tSec` (seconds, increasing); the result is in `x`, `y`, `z`. */
  filter(tSec: number, x: number, y: number, z: number): void;
  /** Forgets the past: the next sample passes through unchanged. */
  reset(): void;
}

/** The smoothing factor of a first-order low-pass at `cutoff` Hz for a step of `dt` seconds. */
const alpha = (cutoff: number, dt: number): number => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export function createOneEuro3(options: OneEuroOptions = {}): OneEuro3 {
  const { minCutoff, beta, dCutoff } = { ...ONE_EURO_DEFAULTS, ...options };
  let primed = false;
  let t = 0;
  let x = 0;
  let y = 0;
  let z = 0;
  let dx = 0;
  let dy = 0;
  let dz = 0;

  return {
    get x() {
      return x;
    },
    get y() {
      return y;
    },
    get z() {
      return z;
    },
    get primed() {
      return primed;
    },
    filter(tSec, nx, ny, nz) {
      if (!primed) {
        primed = true;
        t = tSec;
        x = nx;
        y = ny;
        z = nz;
        dx = dy = dz = 0;
        return;
      }
      const dt = tSec - t;
      // a repeated or out-of-order timestamp carries no speed: keep the last output
      if (!(dt > 0)) return;
      t = tSec;
      const ad = alpha(dCutoff, dt);
      dx += ad * ((nx - x) / dt - dx);
      dy += ad * ((ny - y) / dt - dy);
      dz += ad * ((nz - z) / dt - dz);
      const a = alpha(minCutoff + beta * Math.sqrt(dx * dx + dy * dy + dz * dz), dt);
      x += a * (nx - x);
      y += a * (ny - y);
      z += a * (nz - z);
    },
    reset() {
      primed = false;
      dx = dy = dz = 0;
    },
  };
}
