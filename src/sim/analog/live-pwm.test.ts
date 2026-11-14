// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bench, capacitor, resistor, uno, unoPin } from "./live-bench.testing.ts";
import type { LiveAnalog } from "./live.ts";

const MS = 1_000_000;
const HZ = 490;
const DUTY = 128 / 255;
const PERIOD_NS = 1e9 / HZ;

// analogWrite(9, 128) into 10 kohm and 10 uF
function filter(analog: { stepNs?: number } = {}): LiveAnalog {
  const a = bench([uno({ D9: "pwm" }), resistor("R1", "pwm", "out", 10_000), capacitor("C1", "out", "gnd", 10e-6)], { mode: "transient", ...analog });
  a.apply([{ kind: "pwm", element: unoPin("D9"), duty: DUTY, hz: HZ }]);
  a.advanceTo(1);
  return a;
}

// the exact steady state of a first order filter driven by a square wave: the average, and the ripple from the two exponentials
const tau = (10_000 + 25) * 10e-6;
const rise = (1 - Math.exp(-(DUTY / HZ) / tau)) * (1 - Math.exp(-((1 - DUTY) / HZ) / tau)) / (1 - Math.exp(-1 / HZ / tau));

// what the output does over two periods starting at `from`
function overTwoPeriods(a: LiveAnalog, from: number) {
  const volts: number[] = [];
  for (let t = from; t < from + 2 * PERIOD_NS; t += PERIOD_NS / 200) {
    a.advanceTo(Math.round(t));
    volts.push(a.netVolts("out")!);
  }
  return { lo: Math.min(...volts), hi: Math.max(...volts), mean: volts.reduce((sum, v) => sum + v, 0) / volts.length };
}

describe("analogWrite into an RC filter in a transient run", () => {
  it("settles to the duty times 5 V, about 2.5 V", () => {
    const a = filter();
    a.advanceTo(2000 * MS);
    expect(overTwoPeriods(a, 2000 * MS).mean).toBeCloseTo(5 * DUTY, 2);
  });

  it("ripples by the amount the two exponentials of one period give", () => {
    const a = filter();
    a.advanceTo(1500 * MS);
    const { lo, hi } = overTwoPeriods(a, 1500 * MS);
    expect(hi - lo).toBeCloseTo(5 * rise, 3);
  });

  it("follows the exponential charge before it settles: 5 D (1 - e^(-t/RC)) is the envelope's trend", () => {
    const a = filter();
    a.advanceTo(100 * MS);
    expect(a.netVolts("out")).toBeCloseTo(5 * DUTY * (1 - Math.exp(-0.1 / tau)), 1);
  });

  it("gives the pin's time average to a resistive load without a time base", () => {
    const a = bench([uno({ D9: "pwm" }), resistor("R1", "pwm", "gnd", 10_000), capacitor("C1", "far", "gnd", 1e-6)], { mode: "dc-event" });
    a.apply([{ kind: "pwm", element: unoPin("D9"), duty: 0.5, hz: HZ }]);
    a.advanceTo(1);
    expect(a.netVolts("pwm")).toBeCloseTo(5 * 0.5 * (10_000 / 10_025), 3);
  });
});
