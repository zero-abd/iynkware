import type { PartLayers } from "./live.ts";
import type { AnalogOptions } from "./types.ts";

/** Descriptor element kinds whose behaviour needs a time base. */
const TIMED = new Set(["capacitor", "inductor", "waveform_source"]);

/**
 * SIMULATION 7.4: a circuit with a capacitor, an inductor or a waveform source runs in transient mode when the backend
 * can, and every other circuit re-solves its operating point when something changes. A backend that cannot step leaves
 * those parts to the solver's "not modelled yet", and the project's own request for transient is honoured only when
 * the backend can.
 */
export function pickAnalogOptions(want: AnalogOptions, layers: ReadonlyMap<string, PartLayers>, capabilities: { transient: boolean }): AnalogOptions {
  if (!capabilities.transient) return { ...want, mode: "dc-event" };
  const timed = [...layers.values()].some((l) => l.elements.some((e) => TIMED.has(e.element)));
  return { ...want, mode: timed || want.mode === "transient" ? "transient" : "dc-event" };
}
