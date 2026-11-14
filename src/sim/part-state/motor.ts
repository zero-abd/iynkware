import { MOTORS } from "../analog/devices/motor.ts";
import type { PartStateProvider } from "./types.ts";

/**
 * A motor's shaft as the live solver turns it: the speed follows the current through the winding against its back-EMF
 * and load. Powered from the stop voltage up; stalled while powered with the shaft still, under the start voltage or
 * held. `ratings` is the entry in `MOTORS` the solver builds the part from.
 */
export function motorProvider(ratings: keyof typeof MOTORS): PartStateProvider {
  const { vStop } = MOTORS[ratings].model;
  return (ctx) => {
    const volts = ctx.across("PLUS", "MINUS");
    const rpm = ctx.rpm();
    if (volts === null || rpm === null || ctx.health() === "burnt") return { kind: "motor", rpm: 0, stalled: false, powered: false };
    const powered = Math.abs(volts) >= vStop;
    const shown = Math.round(rpm);
    return { kind: "motor", rpm: shown, stalled: powered && shown === 0, powered };
  };
}
