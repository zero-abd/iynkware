import { PWL_COMPAT } from '../elements.ts';
import type { DeviceState, ElementOa, TransientStep } from '../types.ts';
import type { NewtonDevice } from './index.ts';

// tanh(u) is within 1 percent of the rail from here on
const SAT_U = 2.65;
// the tanh argument may move this far in one Newton iteration, or as far again as the drive already is when that is more
const DRIVE_REACH = 1;
// the pole's state is kept this many clamp widths from the middle of the rails
const WINDUP = 3;
// the largest share of the clamp's half width the slew limit may put the pole's state on
const SLEW_EDGE = 1 - 1e-9;

interface Response { y: number; slope: number; t: number; sat: boolean; pole: number }

// The pole's weight on one step: the output moves this share of the way to the target. Without a step the output is the target.
function gainOf(e: ElementOa, step?: TransientStep): { a: number; k: number } {
  if (!step || e.gbwHz <= 0) return { a: Infinity, k: 1 };
  const a = ((step.method === 'trapezoidal' ? 0.5 : 1) * step.hSeconds * 2 * Math.PI * e.gbwHz) / e.openLoopGain;
  return { a, k: a / (1 + a) };
}

// The output follows the gain times the input difference through one pole at gbw / gain (trapezoidal or backward Euler on
// the step), and only then is held inside the rails by a smooth clamp, so a closed loop leaves saturation as fast as the loop
// allows. What carries on is the pole's state, kept within WINDUP clamp widths so a long overdrive does not wind it up. The
// rails are read at the iterate and not differentiated.
function respond(e: ElementOa, x: Float64Array, step?: TransientStep, u?: number): Response {
  const lo = x[e.vee] + (e.headroomLowVolts ?? e.headroomVolts), hi = x[e.vcc] - e.headroomVolts;
  const mid = (hi + lo) / 2;
  if (hi <= lo) return { y: mid, slope: 0, t: mid, sat: true, pole: mid };
  const half = (hi - lo) / 2;
  u ??= (e.openLoopGain * (x[e.inP] - x[e.inN])) / half;
  const target = mid + u * half;
  const held = (w: number) => mid + half * Math.max(-WINDUP, Math.min(WINDUP, (w - mid) / half));
  const { a, k } = gainOf(e, step);
  const prev = step?.prev[e.id];
  const wPrev = prev?.kind === 'OA' ? prev.pole : held(target);
  const tPrev = prev?.kind === 'OA' ? prev.target : target;
  const trap = step?.method === 'trapezoidal';
  const w = Number.isFinite(a) ? ((trap ? (1 - a) * wPrev + a * tPrev : wPrev) + a * target) / (1 + a) : target;
  const th = Math.tanh((w - mid) / half);
  let y = mid + half * th;
  let slope = k * e.openLoopGain * (1 - th * th);
  let pole = held(w);
  if (step) {
    const yPrev = mid + half * Math.tanh((wPrev - mid) / half);
    const reach = e.slewVPerUs * 1e6 * step.hSeconds;
    const limited = y > yPrev + reach ? yPrev + reach : y < yPrev - reach ? yPrev - reach : null;
    if (limited !== null) {
      y = limited;
      slope = 0;
      pole = mid + half * Math.atanh(Math.max(-SLEW_EDGE, Math.min(SLEW_EDGE, (y - mid) / half)));
    }
  }
  return { y, slope, t: target, sat: Math.abs((w - mid) / half) > SAT_U, pole };
}

const siemens = (e: ElementOa) => 1 / Math.max(e.rOutOhms, PWL_COMPAT.minOhms);

// With less supply than the output stage needs between the rails the amplifier is off and its output is released
const powered = (e: ElementOa, x: Float64Array) => x[e.vcc] - x[e.vee] > e.headroomVolts + (e.headroomLowVolts ?? e.headroomVolts);

function amps(e: ElementOa, x: Float64Array, step?: TransientStep): number {
  return powered(e, x) ? (respond(e, x, step).y - x[e.out]) * siemens(e) : 0;
}

export const opampDevice: NewtonDevice<ElementOa> = {
  kind: 'OA',
  validate(e) {
    if (!(e.openLoopGain > 0 && Number.isFinite(e.openLoopGain))) return `openLoopGain ${e.openLoopGain} is not positive`;
    if (!(e.gbwHz >= 0 && Number.isFinite(e.gbwHz))) return `gbwHz ${e.gbwHz} is negative`;
    if (!(e.slewVPerUs > 0)) return `slewVPerUs ${e.slewVPerUs} is not positive`;
    if (!(e.rOutOhms >= 0)) return `rOutOhms ${e.rOutOhms} is negative`;
    if (!(e.headroomVolts >= 0)) return `headroomVolts ${e.headroomVolts} is negative`;
    return null;
  },
  stamp(e, x, s, lim, step) {
    if (!powered(e, x)) return;
    const g = siemens(e);
    // the drive is limited like a junction voltage: each iteration may move the clamp's argument a few units along the tanh, and through the pole that takes a drive 1 / k times as large
    const half = (x[e.vcc] - x[e.vee] - e.headroomVolts - (e.headroomLowVolts ?? e.headroomVolts)) / 2;
    const unew = half > 0 ? (e.openLoopGain * (x[e.inP] - x[e.inN])) / half : 0;
    const was = s.junctionVolts.get(e.id) ?? unew;
    const u = half > 0 ? lim.within(unew, was, Math.max(DRIVE_REACH / gainOf(e, step).k, Math.abs(was))) : unew;
    s.junctionVolts.set(e.id, u);
    const vd = half > 0 ? (u * half) / e.openLoopGain : x[e.inP] - x[e.inN];
    const r = respond(e, x, step, u);
    s.conduct(e.out, s.ground, g);
    s.transconduct(s.ground, e.out, e.inP, e.inN, r.slope * g);
    s.current(s.ground, e.out, (r.y - r.slope * vd) * g);
  },
  memory(e, x, step) {
    const r = respond(e, x, step);
    return { kind: 'OA', pole: r.pole, target: r.t };
  },
  currents: (e, x, step) => [amps(e, x, step)],
  measure(e, x, step) {
    const i = amps(e, x, step);
    const sat: DeviceState = !powered(e, x) ? 'off' : respond(e, x, step).sat ? 'sat' : 'active';
    return { amps: i, volts: x[e.out], watts: i * i * e.rOutOhms, state: sat };
  },
};
