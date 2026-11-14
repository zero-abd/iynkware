import { netResolver } from "@/lib/interp/pins";
import type { PinState } from "@/lib/interp/world";
import type { SimNetlist } from "@/sim/engine";
import type { InterpEngine } from "./interp-engine";

const RAILS: readonly (readonly [RegExp, number])[] = [
  [/^GND/, 0],
  [/^P?3V3$/, 3.3],
  [/^P?5V$/, 5],
];

/** The average voltage a pin holds, or null when nothing drives it. A PWM output reads as its duty times the logic level. */
function pinVolts(pin: PinState | undefined, logicV: number): number | null {
  if (!pin) return null;
  if (pin.volts !== null) return pin.volts;
  if (pin.dac !== null) return pin.dac;
  if (pin.mode === "output") return (pin.duty ?? pin.out) * logicV;
  if (pin.ext !== null) return pin.ext * logicV;
  return pin.mode === "input_pullup" ? logicV : null;
}

/**
 * What a meter can read on a net without a circuit solver: ground and the board's supply pins, and any net with a
 * board pin on it, from the level or voltage the sketch or the wiring puts on that pin. A net that only joins
 * passive parts has no such pin, so it reads null and the meter says it is not modelled. Reads leave the run alone.
 */
export function boardNetVolts(net: SimNetlist, engine: Pick<InterpEngine, "run">): (netId: string) => number | null {
  const board = net.parts.find((p) => p.kind === "board");
  return (netId) => {
    if (!board) return null;
    const { world } = engine.run;
    const resolve = netResolver(world.profile);
    for (const [name, target] of Object.entries(board.pins)) {
      if (target !== netId) continue;
      const rail = RAILS.find(([pattern]) => pattern.test(name));
      if (rail) return rail[1];
      const n = resolve(name);
      const volts = typeof n === "number" ? pinVolts(world.pins.get(n), world.profile.logicV) : null;
      if (volts !== null) return volts;
    }
    return null;
  };
}
