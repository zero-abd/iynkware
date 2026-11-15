import { describe, expect, it } from 'vitest';
import { FULL_HZ, IDLE_HZ, motorGain, motorHz } from '../src/range/flight/motor/model';

describe('motor sound', () => {
  it('rises in pitch and loudness with throttle', () => {
    expect(motorHz(0)).toBe(IDLE_HZ);
    expect(motorHz(1)).toBe(FULL_HZ);
    expect(motorGain(1, true, false, true, 0.7)).toBeGreaterThan(motorGain(0, true, false, true, 0.7));
    expect(motorGain(0, true, false, true, 0.7)).toBeGreaterThan(0);
  });
  it('is silent when disarmed, crashed, muted or the bus is down', () => {
    expect(motorGain(1, false, false, true, 1)).toBe(0);
    expect(motorGain(1, true, true, true, 1)).toBe(0);
    expect(motorGain(1, true, false, false, 1)).toBe(0);
    expect(motorGain(1, true, false, true, 0)).toBe(0);
  });
});
