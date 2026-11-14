import type { AnalogFrame } from "@/sim-host/analog-protocol";

/** The newest value of everything the run has reported about its circuit: a frame's deltas laid over the last state. */
export type AnalogView = Required<Omit<AnalogFrame, "full" | "waves">> & { waves: NonNullable<AnalogFrame["waves"]> };

export const emptyAnalog = (): AnalogView => ({ volts: {}, amps: {}, pinAmps: {}, parts: {}, waves: {}, instruments: {} });

/** A full frame starts again from nothing; any other frame changes only the keys it carries. */
export function mergeAnalog(prev: AnalogView | null, frame: AnalogFrame): AnalogView {
  const base = frame.full || !prev ? emptyAnalog() : prev;
  const pinAmps = { ...base.pinAmps };
  for (const [part, pins] of Object.entries(frame.pinAmps ?? {})) pinAmps[part] = { ...pinAmps[part], ...pins };
  return {
    volts: { ...base.volts, ...frame.volts },
    amps: { ...base.amps, ...frame.amps },
    pinAmps,
    parts: { ...base.parts, ...frame.parts },
    waves: { ...base.waves, ...frame.waves },
    instruments: { ...base.instruments, ...frame.instruments },
  };
}
