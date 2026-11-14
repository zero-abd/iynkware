// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bench, capacitor, layered, resistor, uno } from "../analog/live-bench.testing.ts";
import { LOADING_OHMS, resistanceBetween } from "./meter.ts";

const BASIS = { at: 0, tier: "T1" as const, modelIds: [] as string[] };
const MS = 1_000_000;

const inductor = (id: string, a: string, b: string, henries: number, dcr: number) => layered(id, "inductor", { a: "P1", b: "P2" }, { henries, dcr_ohms: dcr, rated_amps: 1 }, { P1: a, P2: b });

const follower = layered(
  "U1",
  "opamp",
  { inp: "IN1P", inn: "IN1N", out: "OUT1", vcc: "VCC", vee: "VEE" },
  { open_loop_gain: 1e5, gbw_hz: 7e5, slew_v_per_us: 0.3, r_out_ohms: 50, headroom_volts: 1.5, headroom_low_volts: 0.02 },
  { IN1P: "half", IN1N: "out", OUT1: "out", VCC: "n5", VEE: "gnd" },
);

describe("the meters read the live solver", () => {
  it("a loaded voltmeter across a charging capacitor reads the charge it holds: 5 (1 - e^-1) after one time constant", () => {
    const a = bench([uno({ "5V": "n5", GND: "gnd" }), resistor("R1", "n5", "out", 1000), capacitor("C1", "out", "gnd", 1e-6)], { mode: "transient", stepNs: MS / 20 });
    a.advanceTo(MS);
    const loaded = a.whatIf({ extra: [{ id: "meter:load", kind: "R", a: a.nodeIndex("out")!, b: 0, ohms: LOADING_OHMS }] });
    expect(loaded.v[a.nodeIndex("out")!]).toBeCloseTo(5 * (1 - Math.exp(-1)), 2);
  });

  it("a loaded voltmeter on an op-amp follower reads what the amplifier drives, not a floating net", () => {
    const a = bench([uno({ "5V": "n5", GND: "gnd" }), resistor("R1", "n5", "half", 10_000), resistor("R2", "half", "gnd", 10_000), follower], { mode: "dc-event" });
    const loaded = a.whatIf({ extra: [{ id: "meter:load", kind: "R", a: a.nodeIndex("out")!, b: 0, ohms: LOADING_OHMS }] });
    expect(loaded.v[a.nodeIndex("out")!]).toBeCloseTo(2.5, 2);
  });

  it("an ohmmeter across an inductor reads its winding, 2 ohm, where a capacitor in parallel stays open", () => {
    const a = bench([inductor("L1", "a", "b", 1e-3, 2), capacitor("C1", "a", "b", 1e-6)], { mode: "transient" });
    expect(resistanceBetween(a, "a", "b", BASIS).ohms).toBeCloseTo(2, 2);
  });

  it("an ohmmeter reads a series resistor and capacitor as open", () => {
    const a = bench([resistor("R1", "a", "m", 1000), capacitor("C1", "m", "b", 1e-6)], { mode: "transient" });
    expect(resistanceBetween(a, "a", "b", BASIS)).toMatchObject({ ohms: null, reading: { value: "open" } });
  });

  it("an ohmmeter does not see an unpowered op-amp's output as a source", () => {
    const a = bench([uno({ "5V": "n5", GND: "gnd" }), resistor("R1", "n5", "half", 10_000), resistor("R2", "half", "gnd", 10_000), follower, resistor("R3", "out", "gnd", 4700)], { mode: "dc-event" });
    expect(resistanceBetween(a, "out", "gnd", BASIS).ohms).toBeCloseTo(4700, 0);
  });
});
