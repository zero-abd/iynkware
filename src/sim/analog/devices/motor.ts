import type { ElementM, MotorModel } from "../types.ts";

/** How often the live solver turns a motor's shaft; short against every mechanical lag below. */
export const MOTOR_STEP_NS = 5_000_000;

/** The ratings of each motor part, from the `elec:` lines of figures/parts/<id>.js. `ohms` is the winding. */
export const MOTORS: Readonly<Record<string, { ohms: number; model: MotorModel }>> = {
  "dc-motor": { ohms: 1.43, model: { keVPerRpm: 3.06e-4, i0Amps: 0.12, iLoadAmps: 0.08, rpmFull: 12500, fricExp: 2, tauS: 0.08, vStart: 1, vStop: 0.6 } },
  "tt-motor": { ohms: 4, model: { keVPerRpm: 0.02436, i0Amps: 0.13, iLoadAmps: 0.03, rpmFull: 220, fricExp: 1, tauS: 0.25, vStart: 1, vStop: 0.6 } },
  // a brushless fan has a driver chip in the hub; it is fitted as a 20 ohm winding with the emf that gives 0.1 A and 6000 rpm at 5 V
  fan: { ohms: 20, model: { keVPerRpm: 5e-4, i0Amps: 0.09, iLoadAmps: 0.01, rpmFull: 6000, fricExp: 1, tauS: 0.3, vStart: 2.5, vStop: 1.8 } },
};

/** The current friction and the load take at `rpm`, without sign. */
export const fricAmps = (m: MotorModel, rpm: number): number => m.i0Amps + m.iLoadAmps * (Math.abs(rpm) / m.rpmFull) ** m.fricExp;

/** The speed the motor settles at with `volts` across the winding, for a stiff supply. Used to see that a run reached it. */
export function steadyRpm(m: MotorModel, ohms: number, volts: number): number {
  const v = Math.abs(volts);
  let rpm = 0;
  for (let k = 0; k < 20; k++) rpm = Math.max(0, (v - fricAmps(m, rpm) * ohms) / m.keVPerRpm);
  return Math.sign(volts) * rpm;
}

/**
 * The shaft speed after `dtS`, given the volts across the leads and the amps the solver measured through the winding.
 * Torque is the current minus what friction takes; the gain makes the lag of a stiffly driven motor `tauS`.
 * A shaft at rest stays put under the start voltage. Friction stops the shaft but never turns it the other way.
 */
export function stepRpm(el: ElementM, volts: number, amps: number, dtS: number): number {
  const m = el.model;
  if (!m || el.held) return 0;
  const rpm = el.rpm ?? 0;
  if (rpm === 0 && Math.abs(volts) < m.vStart) return 0;
  const dir = Math.sign(rpm) || Math.sign(volts);
  const gain = el.ohms / (m.tauS * m.keVPerRpm);
  const next = rpm + gain * (amps - dir * fricAmps(m, rpm)) * Math.min(dtS, m.tauS / 2);
  if (rpm !== 0 && Math.sign(next) !== Math.sign(rpm) && Math.abs(amps) <= fricAmps(m, 0)) return 0;
  if (Math.abs(next) < 0.5 && Math.abs(volts) < m.vStop) return 0;
  return next;
}
