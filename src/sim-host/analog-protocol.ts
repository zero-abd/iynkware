import type { SimTime } from "@/sim/core/clock";
import type { ElementId, InstrumentAck, InstrumentReading } from "@/sim/analog/types";

export type { InstrumentReading, InstrumentSource, WaveSpec } from "@/sim/analog/types";

/** The analog half of the sim protocol: what a frame carries to the page and how the page drives a bench instrument. SIM_ANALOG sections 5 to 7. */

export type PartHealth = "ok" | "hot" | "burnt" | "reversed";

/** What the page asks the frame to carry. Absent, or never sent, a frame has no `analog` field. A later `analog.watch` replaces the earlier one. */
export interface AnalogWatch {
  /** Net ids. */
  volts: "all" | string[];
  /** Element ids. */
  amps: "all" | ElementId[];
  /** Per part pin, as `pinAmps`. */
  pinAmps: boolean;
  /** Ids of probes added with `probe.add`; at most `MAX_WAVE_WATCH`. */
  waves: string[];
}

/** A value is sent again only when it differs from the last one sent by more than `rel` of its size plus `abs`. */
export const ANALOG_DELTA = { rel: 1e-6, voltsAbs: 1e-6, ampsAbs: 1e-9, wattsAbs: 1e-9 } as const;

export const MAX_WAVE_WATCH = 8;
export const MAX_WAVE_SAMPLES = 512;

export interface AnalogPartFrame {
  /** Power the part dissipates, in watts; a source reports the power it delivers as a negative number. */
  watts: number;
  state: PartHealth;
  /** Present once the part is `burnt`: a key of the `fidelity.states` messages and the numbers its text names. */
  why?: { key: string; args: Record<string, string | number> };
}

/** Samples on a uniform grid: sample `k` is at `fromNs + k * stepNs`. At most `MAX_WAVE_SAMPLES` per probe per frame. */
export interface WaveSamples {
  fromNs: SimTime;
  stepNs: number;
  /** Volts for a voltage probe, amps for a current probe. */
  v: number[];
}

/**
 * The analog part of a frame. Everything but `full` is a delta against the last frame sent for this run: a missing key
 * means unchanged, not zero. `full` is true on the first frame after a load, a reset or a new `analog.watch`, and then
 * carries every watched value.
 */
export interface AnalogFrame {
  full: boolean;
  /** Volts by net id, relative to the ground net. */
  volts?: Record<string, number>;
  /** Amps by element id, positive from the element's first node to its second (or into its first terminal). */
  amps?: Record<ElementId, number>;
  /** Amps by part id, then pin name, positive into the part through that pin. */
  pinAmps?: Record<string, Record<string, number>>;
  /** Power and health by part id. Sent whatever the watch, so a part that burns is reported with every view and lens setting. */
  parts?: Record<string, AnalogPartFrame>;
  /** By probe id. */
  waves?: Record<string, WaveSamples>;
  /** By instrument id. */
  instruments?: Record<string, InstrumentReading>;
}

/** The ack of `instrument.set` and `instrument.clear`. */
export type InstrumentReply = InstrumentAck;
