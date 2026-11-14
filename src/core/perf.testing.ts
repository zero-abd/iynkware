// Wall-clock budgets in the perf tests are set on the reference machine: Amar's 14-core Mac (arm64), quiet. There
// every budget is exactly the number the test names. Another machine gets them scaled by how much slower it runs one
// fixed workload, and, because a different CPU speeds code up unevenly (on a GitHub runner the calibration ran 2x
// slower and project hashing 3.6x), a further 2x margin: off the reference machine a budget catches a gross
// regression, not a small one. A faster machine never tightens a budget.
import { arch, cpus } from "node:os";

const REFERENCE = { arch: "arm64", cpus: 14 };
/** Fastest run of `calibrationWork` on the reference machine, in ms. Re-measure with `measureCalibration` if the workload changes. */
const REFERENCE_MS = 10.0;
const OTHER_MACHINE_MARGIN = 2;

/**
 * Uint32 bit mixing (what hashing costs), string building (pretty printing), and JSON and Map work. None of it calls
 * app code, so a slowdown in the code under test cannot raise its own budget.
 */
function calibrationWork(): number {
  const words = new Uint32Array(64);
  let a = 0x6a09e667, b = 0xbb67ae85;
  for (let round = 0; round < 40_000; round++) {
    for (let t = 0; t < 64; t++) {
      const x = words[(t + 49) & 63];
      words[t] = (words[t] + (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14))) + a) | 0;
      a = (((b >>> 6) | (b << 26)) ^ (a & b) ^ (~a & x)) + words[t] | 0;
      b = (b + a) | 0;
    }
  }
  let text = "";
  for (let i = 0; i < 40_000; i++) text += `  "k${i}": ${i * 0.5},\n`;
  const rows = Array.from({ length: 10_000 }, (_, i) => ({ id: `p${i}`, x: i * 1.5, pins: [i, i + 1, i + 2], label: "part " + i }));
  const json = JSON.stringify(rows);
  const byId = new Map((JSON.parse(json) as typeof rows).map((row) => [row.id, row]));
  return a + b + text.length + json.length + byId.size;
}

export function measureCalibration(runs = 9): number {
  calibrationWork();
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    calibrationWork();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

let scale: number | undefined;

/** How much to widen the budgets on this machine, never below 1. */
export function machineScale(): number {
  if (scale === undefined) {
    const reference = arch() === REFERENCE.arch && cpus().length === REFERENCE.cpus;
    scale = Math.max(1, measureCalibration() / REFERENCE_MS) * (reference ? 1 : OTHER_MACHINE_MARGIN);
    if (scale > 1) console.log(`perf budgets scaled ${scale.toFixed(2)}x for this machine${reference ? "" : " (not the reference machine)"}`);
  }
  return scale;
}

/** A wall-clock budget set on the reference machine, scaled for this one. */
export const budgetMs = (ms: number): number => ms * machineScale();
