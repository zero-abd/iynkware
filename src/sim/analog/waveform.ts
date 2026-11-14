import type { ElementVw } from './types.ts';

export type Wave = Pick<ElementVw, 'shape' | 'amplitudeV' | 'offsetV' | 'hz' | 'duty' | 'phaseDeg'>;

// The one definition of a waveform, so the solver, the function generator and the tests read the same numbers.
// With no frequency there is no time axis and the source holds its value at phase 0.
export function waveValue(w: Wave, tSeconds: number): number {
  const turns = (w.hz > 0 ? w.hz * tSeconds : 0) + w.phaseDeg / 360;
  const c = turns - Math.floor(turns);
  switch (w.shape) {
    case 'sine':
      return w.offsetV + w.amplitudeV * Math.sin(2 * Math.PI * c);
    case 'triangle':
      return w.offsetV + w.amplitudeV * (c < 0.25 ? 4 * c : c < 0.75 ? 2 - 4 * c : 4 * c - 4);
    case 'square':
      return w.offsetV + (c < 0.5 ? w.amplitudeV : -w.amplitudeV);
    case 'pulse':
      return c < w.duty ? w.offsetV + w.amplitudeV : w.offsetV;
  }
}
