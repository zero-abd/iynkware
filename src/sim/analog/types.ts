import type { SolveDiagnostic } from '../core/diagnostic.ts';

export type ElementId = string;

/** What a part can take before the failure rules latch it; a rule with no figure here does not apply. */
export interface PartRating {
  icmaxAmps?: number;
  tjmaxC?: number;
  thetaCPerW?: number;
  vabsVolts?: number;
  pmaxWatts?: number;
}

/** A source that holds its current at `amps` by letting its voltage sag. */
export interface SourceLimit { amps: number; mode: 'droop' }

interface ElementBase { id: ElementId; rating?: PartRating }

export interface ElementR extends ElementBase { kind: 'R'; a: number; b: number; ohms: number }
export interface ElementPot extends ElementBase { kind: 'POT'; a: number; wiper: number; b: number; ohms: number; position: number }
export interface ElementV extends ElementBase { kind: 'V'; a: number; b: number; volts: number; rSeriesOhms: number; limit?: SourceLimit }
export interface ElementPin extends ElementBase { kind: 'PIN'; a: number; level: 0 | 1 | 'Z'; vHighVolts: number; rOutOhms: number; maxAmps: number; pull?: 'up' | 'down' }
export interface ElementPwm extends ElementBase { kind: 'PWM'; a: number; duty: number; hz: number; vHighVolts: number; rOutOhms: number; mode: 'averaged' | 'edge' | 'cycle'; maxAmps?: number }
/**
 * The Shockley parameters of a junction; `vbrVolts` is the reverse breakdown voltage as a positive number. `rsOhms` is the
 * series resistance; `rzOhms` replaces it while the junction is reversed, which is the slope of a Zener in breakdown.
 */
export interface DiodeParams { kind: 'shockley'; isAmps: number; n: number; rsOhms: number; rzOhms?: number; vbrVolts?: number }

/** `junction` is what `mode: 'newton'` solves; `pwl` reads `vf` and `rdOhms`. */
export interface ElementD extends ElementBase { kind: 'D'; a: number; b: number; modelId: string; vf: number; rdOhms: number; maxAmps: number; junction?: DiodeParams }
/** Gummel-Poon in transport form; `rcOhms`, `rbOhms` and `reOhms` are the series resistances. */
export interface BjtParams { kind: 'gummel-poon'; isAmps: number; bf: number; br: number; nf?: number; vafVolts?: number; rcOhms?: number; rbOhms?: number; reOhms?: number }

/** `vthVolts` is the threshold in the device's own polarity, so it is positive for an enhancement part of either kind. */
export type MosParams =
  | { kind: 'switch'; rdsOnOhms: number; vthVolts: number; rOffOhms: number }
  | { kind: 'level1'; vthVolts: number; kpAmpsPerV2: number; lambdaPerV: number };

/** `params` is what `mode: 'newton'` solves; `pwl` reads `hfe`, `hfr`, `vbe` and `vcesat`. */
export interface ElementQ extends ElementBase { kind: 'Q'; c: number; b: number; e: number; polarity: 'npn' | 'pnp'; modelId: string; hfe: number; hfr: number; vbe: number; vcesat: number; params?: BjtParams }
export interface ElementMos extends ElementBase { kind: 'MOS'; d: number; g: number; s: number; polarity: 'n' | 'p'; modelId: string; params?: MosParams }
/**
 * What makes a motor turn: back-EMF per rpm, the current that friction and the load take (`i0Amps` at rest, `iLoadAmps`
 * more at `rpmFull`, rising as `fricExp` of the speed), the start and stop volts and the mechanical lag `tauS`.
 */
export interface MotorModel {
  keVPerRpm: number;
  i0Amps: number;
  iLoadAmps: number;
  rpmFull: number;
  fricExp: 1 | 2;
  tauS: number;
  vStart: number;
  vStop: number;
}

/**
 * `form` absent or 'legacy' is the conductance the solver settles on. 'emf' is `ohms` in series with a voltage
 * source of `emfV` that opposes the current from a to b. A current-sink form was not needed and is not built.
 * With a `model` the live solver turns the shaft: `rpm` (signed, positive when a is the higher lead) follows the
 * current the element carries, and `emfV` follows `rpm`. `held` is a shaft that cannot turn.
 */
export interface ElementM extends ElementBase { kind: 'M'; a: number; b: number; ohms: number; form?: 'legacy' | 'emf'; emfV?: number; model?: MotorModel; rpm?: number; held?: boolean }
export interface ElementSv extends ElementBase { kind: 'SV'; gnd: number; vplus: number; sig: number }
export interface ElementTs extends ElementBase { kind: 'TS'; supplyPos: number; supplyNeg: number; out: number; outVolts?: number }
export interface ElementBz extends ElementBase { kind: 'BZ'; a: number; b: number; active: boolean; vf: number; rdOhms: number }

/**
 * A capacitor. `a` is the positive lead when `polarized`; the part reads as reversed once `v` across it falls below zero.
 * `v0` is the starting voltage a to b; without it the transient starts from the operating point. `ratedVolts` is the
 * working voltage the failure rule compares against.
 */
export interface ElementC extends ElementBase { kind: 'C'; a: number; b: number; farads: number; esrOhms: number; v0?: number; polarized: boolean; ratedVolts?: number }
/** An inductor. `i0` is the starting current a to b, `ratedAmps` the saturation or fuse figure the failure rule compares against. */
export interface ElementL extends ElementBase { kind: 'L'; a: number; b: number; henries: number; dcrOhms: number; i0?: number; ratedAmps?: number }

/**
 * `sine`, `triangle` and `square` swing `offsetV` plus and minus `amplitudeV` (a peak, not peak to peak); `square` is
 * always half high. `pulse` sits at `offsetV` and goes up to `offsetV + amplitudeV` for the fraction `duty` of each period.
 */
export type WaveShape = 'sine' | 'square' | 'triangle' | 'pulse';

/** A voltage source that follows a waveform; `limit` droops it like the source `V`. With no time base it holds the value at phase 0. */
export interface ElementVw extends ElementBase {
  kind: 'VW'; a: number; b: number;
  shape: WaveShape; amplitudeV: number; offsetV: number; hz: number; duty: number; phaseDeg: number;
  rSeriesOhms: number; limit?: SourceLimit;
}

/**
 * An op-amp macro model. `openLoopGain` is the DC gain in V/V, `gbwHz` the gain bandwidth product, `slewVPerUs` the
 * largest output rate of change. The output saturates `headroomVolts` inside the positive rail and `headroomLowVolts` (the
 * same when absent) inside the negative one.
 */
export interface ElementOa extends ElementBase {
  kind: 'OA'; inP: number; inN: number; out: number; vcc: number; vee: number;
  openLoopGain: number; gbwHz: number; slewVPerUs: number; rOutOhms: number; headroomVolts: number; headroomLowVolts?: number;
}

/**
 * A 555 timer, in its bipolar form: three equal divider resistors inside set the thresholds at two thirds and one third
 * of `ctrl`'s level, which is `vcc` when `ctrl` floats. `highDropVolts` is how far `out` sits below `vcc` when high,
 * `disOnOhms` the discharge transistor's resistance when it conducts, `quiescentAmps` what the chip draws from `vcc`.
 */
export interface ElementTmr extends ElementBase {
  kind: 'TMR'; gnd: number; trig: number; out: number; reset: number; ctrl: number; thr: number; dis: number; vcc: number;
  rOutOhms: number; highDropVolts: number; disOnOhms: number; quiescentAmps: number;
  /** The output latch (1 is out high). Absent it starts low; a solve sets it to the state it settled on. */
  latch?: 0 | 1;
}

export type Element =
  | ElementR | ElementPot | ElementV | ElementPin | ElementPwm | ElementD | ElementQ | ElementMos | ElementM | ElementSv | ElementTs | ElementBz
  | ElementC | ElementL | ElementVw | ElementOa | ElementTmr;

/**
 * How the analog layer advances. `dc-event` re-solves the operating point when something changes, as the live solver
 * does today; `transient` also steps the reactive elements every `stepNs`, or every step the solver sizes from the circuit (`autoStepNs`) when it is absent. It is `SimSettings.analog`, and the project
 * document carries it in `simulation.solver.options` (`mode`, `stepNs`), which is an open object, so no migration.
 */
export interface AnalogOptions { mode: 'dc-event' | 'transient'; stepNs?: number }

/** The wave a function generator makes: the parameters of the `VW` element. */
export interface WaveSpec {
  shape: WaveShape;
  amplitudeV: number;
  offsetV: number;
  hz: number;
  duty: number;
  phaseDeg: number;
}

/**
 * A source the page puts between two points while the run is going. `pos` and `neg` are net ids of the run's netlist
 * (the page resolves a probe point to its net the way probes do); the source is a `VW` (fgen) or a `V` (psu) between them.
 */
export type InstrumentSource =
  | { kind: 'fgen'; pos: string; neg: string; wave: WaveSpec; rSeriesOhms: number; limitAmps?: number }
  | { kind: 'psu'; pos: string; neg: string; volts: number; limitAmps: number };

/** The answer to putting a source in: `not-modelled-yet` when the solver has no model for it, `unknown-net` for a net the run lacks or two ends on one net, `too-many` past `MAX_INSTRUMENT_SOURCES`. */
export type InstrumentAck = { ok: true } | { ok: false; reason: 'not-modelled-yet' | 'unknown-net' | 'too-many' };

export const MAX_INSTRUMENT_SOURCES = 8;

/** What a bench source reports back. `limiting` is true while it holds its current limit instead of its set voltage. */
export interface InstrumentReading {
  /** Volts across the source's two points, positive end first. */
  volts: number;
  /** Amps the source delivers out of its positive point. */
  amps: number;
  limiting: boolean;
}

export type IntegrationMethod = 'trapezoidal' | 'backward-euler';

/** What one dynamic element remembers from the step before: a capacitor and an inductor the voltage across the ideal part and the current through it (a to b), an op-amp the state of its pole and the unclamped drive the pole is chasing, a 555 its latch. */
export type ElementMemory =
  | { kind: 'C'; v: number; i: number }
  | { kind: 'L'; v: number; i: number }
  | { kind: 'OA'; pole: number; target: number }
  | { kind: 'TMR'; q: 0 | 1 };

export type TransientMemory = Record<ElementId, ElementMemory>;

/**
 * One transient step: `hSeconds` long and ending at `tSeconds`. A discontinuity, a ringing detection and the first step
 * use `backward-euler`; every other step `trapezoidal`. `prev` is the `memory` the step before returned, empty on the first.
 */
export interface TransientStep { tSeconds: number; hSeconds: number; method: IntegrationMethod; prev: TransientMemory }

export interface SolveOptions {
  mode: 'pwl' | 'newton';
  reltol: number;
  vabstol: number;
  iabstol: number;
  maxIter: number;
  gminSiemens: number;
  homotopy: Array<'gmin' | 'source'>;
}

export type DeviceState = 'off' | 'on' | 'sat' | 'active' | 'open' | 'burnt';

export interface SolveResult {
  converged: boolean;
  iterations: number;
  strategy: 'direct' | 'damped' | 'gmin-stepping' | 'source-stepping';
  v: Float64Array;
  branch: Record<ElementId, { amps: number; volts: number; watts: number }>;
  state: Record<ElementId, DeviceState>;
  residual: { maxKclAmps: number; worstNode: number };
  diagnostics: SolveDiagnostic[];
  /** Set by a transient step: what each dynamic element carries into the next one. */
  memory?: TransientMemory;
}

interface RegulatorBase {
  voutVolts: number;
  ilimitAmps?: number;
  quiescentAmps?: number;
  efficiency?: number;
  thermal?: { thetaJaCperW: number; shutdownCelsius: number };
}

/** A regulator that follows its input down by a dropout once the input comes within `dropoutVolts` of the output. */
export interface DropoutRegulator extends RegulatorBase {
  kind: "linear" | "buck" | "boost";
  dropoutVolts: number;
}

/** A buck-boost holds its output across the whole input range and has no dropout; outside the range it gives nothing. */
export interface BuckBoostRegulator extends RegulatorBase {
  kind: "buck-boost";
  minInVolts: number;
  maxInVolts: number;
}

export type RegulatorModel = DropoutRegulator | BuckBoostRegulator;

export interface BrownoutDetector {
  thresholdVolts: number;
  hysteresisVolts: number;
  minDwellNs: number;
  resetNs: number;
}
