import { VT_300K } from "./devices/diode.ts";
import type { Element, SolveOptions } from "./types.ts";

/** The solver settings of a circuit with a capacitor, a Zener or an amplifier: SPICE's defaults, not the tight ones of the piecewise linear solver. */
export const NEWTON_OPTIONS: SolveOptions = { mode: "newton", reltol: 1e-3, vabstol: 1e-6, iabstol: 1e-12, maxIter: 100, gminSiemens: 1e-12, homotopy: ["gmin", "source"] };

const LED_IDEALITY = 2;
const DIODE_IDEALITY = 1.8;
const TRANSISTOR_TEST_AMPS = 1e-3;
// a datasheet quotes the forward voltage at about this current
const DIODE_TEST_AMPS = 0.02;

/** Kinds that only the Newton solver can solve. */
const NEEDS_NEWTON: ReadonlySet<Element["kind"]> = new Set(["C", "L", "VW", "OA", "TMR"]);

export function needsNewton(elements: readonly Element[]): boolean {
  return elements.some((el) => NEEDS_NEWTON.has(el.kind) || (el.kind === "D" && el.junction?.vbrVolts !== undefined));
}

/**
 * The piecewise linear parts of a circuit as the Newton solver reads them. A diode with only a forward voltage gets the
 * Shockley curve that passes through that voltage at 20 mA (or its rated current when that is less); a transistor gets the Gummel-Poon figures that
 * give its base-emitter voltage at a milliamp. A PWM pin is a square wave when the run has a time base (`timed`) and its time
 * average when it has none. Every other element is returned as it is.
 */
export function forNewton(el: Element, timed: boolean): Element {
  if (el.kind === "PWM" && el.mode !== "cycle") return { ...el, mode: timed ? "edge" : "averaged" };
  if (el.kind === "D" && !el.junction) {
    const n = el.modelId.startsWith("model:led.") ? LED_IDEALITY : DIODE_IDEALITY;
    const at = Math.min(el.maxAmps, DIODE_TEST_AMPS);
    const isAmps = at / Math.exp((el.vf - at * el.rdOhms) / (n * VT_300K));
    return { ...el, junction: { kind: "shockley", isAmps, n, rsOhms: el.rdOhms } };
  }
  if (el.kind === "Q" && !el.params) {
    return { ...el, params: { kind: "gummel-poon", isAmps: TRANSISTOR_TEST_AMPS / Math.exp(el.vbe / VT_300K), bf: el.hfe, br: el.hfr } };
  }
  return el;
}
