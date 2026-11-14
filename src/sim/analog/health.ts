import type { Element } from "./types.ts";

/** `burnt` is not here: the failure latch decides it, not the operating point. */
export type PartHealth = "ok" | "hot" | "burnt" | "reversed";

interface Branch {
  amps: number;
  volts: number;
  watts: number;
}

const TMP36_REVERSED_VOLTS = -0.5;
const CAPACITOR_REVERSED_VOLTS = -0.5;

/**
 * What an element's present operating point says about its health, before any latch: `hot` while a rating is exceeded
 * and `reversed` while a polarity-sensitive part is fed the wrong way round. The failure rules in `states.ts` decide when
 * that turns into `burnt`.
 */
export function elementHealth(el: Element, b: Branch): Exclude<PartHealth, "burnt"> {
  switch (el.kind) {
    case "D":
      return Math.abs(b.amps) > el.maxAmps ? "hot" : "ok";
    case "C":
      if (el.polarized && b.volts < CAPACITOR_REVERSED_VOLTS) return "reversed";
      return el.ratedVolts !== undefined && b.volts > el.ratedVolts ? "hot" : "ok";
    case "L":
      return el.ratedAmps !== undefined && Math.abs(b.amps) > el.ratedAmps ? "hot" : "ok";
    case "OA":
    case "TMR":
      return el.rating?.icmaxAmps !== undefined && Math.abs(b.amps) > el.rating.icmaxAmps ? "hot" : "ok";
    case "Q":
      return el.rating?.icmaxAmps !== undefined && b.amps > el.rating.icmaxAmps ? "hot" : "ok";
    case "POT":
    case "R":
    case "M":
      return el.rating?.pmaxWatts !== undefined && b.watts > el.rating.pmaxWatts ? "hot" : "ok";
    case "TS":
      return b.volts < TMP36_REVERSED_VOLTS ? "reversed" : el.rating?.vabsVolts !== undefined && b.volts > el.rating.vabsVolts ? "hot" : "ok";
    case "PIN":
    case "PWM":
      return el.maxAmps !== undefined && Math.abs(b.amps) > el.maxAmps ? "hot" : "ok";
    default:
      return "ok";
  }
}
