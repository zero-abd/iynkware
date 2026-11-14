import type { Descriptor } from "./descriptor.ts";

/** What a badge says about a part: its simulation status, or "mechanical" for a part with no electrical job. */
export type ModelLabel = "modelled" | "partly-modelled" | "not-modelled-yet" | "mechanical";

const MECHANICAL_TAG = "mechanical";

/**
 * A part tagged `mechanical` that has no model is used by the robot builder and its physics, not by the circuit
 * solver, so it reads "Mechanical part" instead of "Not modelled yet". Its stored status stays `not-modelled-yet`.
 */
export function modelLabelOf(d: Pick<Descriptor, "simulation" | "identity">): ModelLabel {
  const { status } = d.simulation;
  return status === "not-modelled-yet" && d.identity.tags?.includes(MECHANICAL_TAG) ? "mechanical" : status;
}
