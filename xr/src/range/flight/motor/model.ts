/** The motor hum as numbers: pitch and loudness from the motor command, no WebAudio here so it can be tested. */

/** Idle and full-throttle pitch of the lowest oscillator, Hz. */
export const IDLE_HZ = 70;
export const FULL_HZ = 230;
/** Peak output (before the simulation bus volume): a hum under the voice, never a blast. */
export const MAX_GAIN = 0.22;
/** Armed and idling is already audible. */
export const IDLE_GAIN = 0.35;

const clamp01 = (v: number) => (v > 1 ? 1 : v > 0 ? v : 0);

export function motorHz(thr: number): number {
  return IDLE_HZ + (FULL_HZ - IDLE_HZ) * clamp01(thr);
}

/** Output gain for a motor command, a bus volume and the sound switch; 0 whenever the motor should be silent. */
export function motorGain(thr: number, armed: boolean, crashed: boolean, soundOn: boolean, bus: number): number {
  if (!armed || crashed || !soundOn || !(bus > 0)) return 0;
  return MAX_GAIN * clamp01(bus) * (IDLE_GAIN + (1 - IDLE_GAIN) * clamp01(thr));
}
