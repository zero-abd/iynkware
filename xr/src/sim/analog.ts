/**
 * The union of several analog watches, for a bridge whose pillars each watch what they draw (contract:
 * `SimBridge.watchAnalog`). The same rule as the scale pillar's feed: `all` wins, lists are merged, `pinAmps` if any
 * asks. Pure.
 */
import type { AnalogWatch } from '../contracts/sim';

/** Most waveform ids a watch may carry (the worker's limit). */
export const MAX_WAVES = 8;

/** The union of `watches`, in owner order: node and part lists are sorted, waveform ids keep the earliest owners' first and stop at 8. */
export function mergeWatches(watches: Iterable<AnalogWatch>): AnalogWatch {
  let volts: 'all' | Set<string> = new Set();
  let amps: 'all' | Set<string> = new Set();
  let pinAmps = false;
  const waves = new Set<string>();
  for (const w of watches) {
    if (w.volts === 'all') volts = 'all';
    else if (volts !== 'all') for (const v of w.volts) volts.add(v);
    if (w.amps === 'all') amps = 'all';
    else if (amps !== 'all') for (const a of w.amps) amps.add(a);
    pinAmps ||= w.pinAmps;
    for (const id of w.waves) if (waves.size < MAX_WAVES) waves.add(id);
  }
  return {
    volts: volts === 'all' ? 'all' : [...volts].sort(),
    amps: amps === 'all' ? 'all' : [...amps].sort(),
    pinAmps,
    waves: [...waves],
  };
}
