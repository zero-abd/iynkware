import type { SimTime } from '../core/clock.ts';
import type { SimNetlist } from '../engine.ts';
import type { AnalogStepResult, Change, LiveAnalog, LoadReport, PartId, PartLayers } from './live.ts';
import type { SolveOptions } from './types.ts';

/**
 * SIMULATION 7.4. The orchestrator talks to this, not to a solver, so the live transient backend can change without
 * touching a caller. A batch backend (`ngspice-batch`) has `interactive: false` and throws `not-interactive` from `advanceTo`.
 */
export interface AnalogBackend {
  readonly kind: 'mna-inhouse' | 'ngspice-stepping' | 'ngspice-batch';
  readonly capabilities: { transient: boolean; coSimulate: boolean; interactive: boolean };
  prepare(net: SimNetlist, o: SolveOptions, layers?: ReadonlyMap<PartId, PartLayers>): LoadReport;
  /** Applies `changes`, then moves the circuit to `t`. */
  advanceTo(t: SimTime, changes: Change[]): AnalogStepResult;
}

/** The in-house solver as a backend. It steps a circuit with reactive parts through time when the netlist's settings ask for `transient`. */
export function inhouseBackend(live: LiveAnalog): AnalogBackend {
  return {
    kind: 'mna-inhouse',
    capabilities: { transient: true, coSimulate: true, interactive: true },
    prepare: (net, o, layers) => live.load(net, o, layers),
    advanceTo(t, changes) {
      live.apply(changes);
      return live.advanceTo(t);
    },
  };
}
