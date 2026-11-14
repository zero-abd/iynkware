import { fsrOhms, ldrOhms, qtrVolts, soilVolts, tmp36Volts } from "../sensors/curves.ts";
import { catalogueName } from "./live.ts";
import type { Change } from "./live.ts";

const flag = (value: number): boolean => value > 0;
const unit = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * What a run-time input of a part (SIM_ANALOG section 8) does to the circuit: `pressed` closes a button, `closed` puts a
 * slide switch on its second end, `pos` turns a pot. Null for a part or a parameter this does not know, so the input
 * falls back to a plain parameter change of the element that carries the part's id.
 */
export function partInputChanges(descriptor: string | undefined, part: string, param: string, value: number): Change[] | null {
  switch (descriptor === undefined ? undefined : catalogueName(descriptor)) {
    case "push-button":
      return param === "pressed" ? [{ kind: "switch", element: part, closed: flag(value) }] : null;
    case "slide-switch":
      return param === "closed"
        ? [
            { kind: "switch", element: `${part}:A`, closed: !flag(value) },
            { kind: "switch", element: `${part}:B`, closed: flag(value) },
          ]
        : null;
    case "potentiometer":
      return param === "pos" ? [{ kind: "param", element: part, path: "pos", value: unit(value) }] : null;
    case "ldr":
      return param === "lux" ? [{ kind: "param", element: part, path: "ohms", value: ldrOhms(value) }] : null;
    case "fsr402":
      return param === "force" ? [{ kind: "param", element: part, path: "ohms", value: fsrOhms(value) }] : null;
    case "soil-moisture":
      return param === "moisture" ? [{ kind: "param", element: part, path: "volts", value: soilVolts(value) }] : null;
    case "tmp36":
      return param === "temp_c" ? [{ kind: "param", element: part, path: "outVolts", value: tmp36Volts(value) }] : null;
    case "qtr-8rc":
      return param === "line" ? qtrVolts(value).map((volts, i) => ({ kind: "param", element: `${part}:OUT${i + 1}`, path: "volts", value: volts })) : null;
    case "hc-sr04":
      // the engines move the obstacle; nothing in the circuit changes
      return param === "distance" ? [] : null;
    default:
      return null;
  }
}
