// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "../../parts/builtin.ts";
import type { Descriptor } from "../../parts/descriptor.ts";
import type { Project } from "../../project/generated/types.ts";
import { PWL_OPTIONS } from "../../sim/analog/elements.ts";
import { solve } from "../../sim/analog/solve.ts";
import type { Element } from "../../sim/analog/types.ts";
import { ratingValue } from "../../sim/models/kinds.ts";
import { buildSimNetlist } from "../../sim/netlist.ts";

// The numbers each starter's guide promises, worked out from the project and the part descriptors, without the
// transient solver: closed forms for the RC and the 555, a small reference integrator for the rectifier, and the
// Newton solver for the Zener. A run of the real transient solver is compared with these when it lands.

const registry = builtinRegistry();
const load = (id: string): Project => JSON.parse(readFileSync(join(__dirname, `${id}.project.json`), "utf8")) as Project;
const descriptor = (ref: string): Descriptor => registry.get(ref, "1.0.0")!;
const SUPPLY = 5;

function partOf(project: Project, refdes: string) {
  const c = project.components.find((x) => x.refdes === refdes);
  if (!c) throw new Error(`no part ${refdes}`);
  const d = descriptor(c.definition.ref);
  const param = (id: string): number => {
    const value = c.params?.[id] ?? d.parameters?.find((p) => p.id === id)?.default;
    if (typeof value !== "number") throw new Error(`${refdes} has no number ${id}`);
    return value;
  };
  return { d, param, rating: (key: string, pick?: "min" | "typ" | "max" | "value") => ratingValue(d, key, pick) };
}

const nearest = (value: number, expected: number, rel: number) => expect(Math.abs(value - expected) / expected).toBeLessThan(rel);

/** The pins joined in each net of the starter, as `REFDES.PIN`, one sorted list per net. Of the Uno only 5V and GND are listed; its other pins are in these nets through the board's own internal shorts. */
function connections(project: Project): string[][] {
  const refdes = new Map([...project.boards, ...project.components].map((c) => [c.id, c.refdes]));
  const { net } = buildSimNetlist(project, registry);
  const byNet = new Map<string, string[]>();
  for (const part of net.parts) {
    if (!refdes.has(part.id)) continue;
    const isBoard = project.boards.some((b) => b.id === part.id);
    for (const [pin, id] of Object.entries(part.pins)) {
      if (id && (!isBoard || pin === "P5V" || pin === "GND")) byNet.set(id, [...(byNet.get(id) ?? []), `${refdes.get(part.id)}.${pin}`]);
    }
  }
  return [...byNet.values()].filter((pins) => pins.length > 1).map((pins) => pins.sort()).sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
}

const high = (r1: number, r2: number, farads: number) => Math.LN2 * (r1 + r2) * farads;
const low = (r2: number, disOn: number, farads: number) => Math.LN2 * (r2 + disOn) * farads;

const IDS = ["rc-led", "blinker-555", "opamp-amplifier", "rectifier", "zener-regulator"];

describe.each(IDS)("%s", (id) => {
  const project = load(id);

  it("says in all six languages what to watch", () => {
    const guide = project.guide!;
    for (const text of [guide.title!, guide.lede!, ...guide.steps!, ...guide.hints!, ...guide.callouts!.map((c) => c.text), ...guide.specs!.flatMap((s) => [s.label, s.value])]) {
      expect(Object.keys(text).sort()).toEqual(["de", "en", "es", "fr", "hi", "zh"]);
    }
    expect(guide.steps!.length).toBeGreaterThanOrEqual(3);
  });

  it("asks for the transient solver", () => {
    expect(project.simulation.solver.options).toMatchObject({ mode: "transient" });
  });

  it("names only parts the registry has and leaves no pin of a part off the breadboard", () => {
    for (const c of project.components) expect(registry.get(c.definition.ref, c.definition.version), c.refdes).toBeDefined();
    const surface = project.views.find((v) => v.kind === "breadboard")!;
    for (const pl of surface.placements) {
      const c = project.components.find((x) => x.id === pl.c);
      if (c && c.definition.ref !== "core.breadboard-half") expect(Object.keys(pl.legs ?? {}).sort(), c.refdes).toEqual(descriptor(c.definition.ref).pins.map((p) => p.id).sort());
    }
  });
});

describe("rc-led", () => {
  const project = load("rc-led");

  it("is a 470 ohm resistor, an LED and a 1000 uF capacitor in series", () => {
    expect(connections(project)).toEqual([
      ["C1.MINUS", "U1.GND"],
      ["C1.PLUS", "LED1.K"],
      ["LED1.A", "R1.P2"],
      ["R1.P1", "U1.P5V"],
    ]);
  });

  it("charges with a time constant of 0.47 s toward 5 V minus the LED drop", () => {
    const r = partOf(project, "R1").param("ohms");
    const c = partOf(project, "C1");
    const led = partOf(project, "LED1");
    const vf = led.rating("forward_voltage_red", "typ");
    const loop = r + led.rating("dynamic_resistance") + c.rating("esr");
    const farads = c.param("farads");
    const tau = loop * farads;
    const vFinal = SUPPLY - vf;

    expect(tau).toBeCloseTo(0.47, 2);
    expect(vFinal).toBeCloseTo(3, 1);
    // one time constant: 63.2 % of the way, about 1.9 V
    const atTau = vFinal * (1 - Math.exp(-1));
    expect(atTau).toBeCloseTo(1.9, 1);
    // the LED starts at about 6 mA and is dark once the capacitor is full
    expect((vFinal / loop) * 1000).toBeCloseTo(6.4, 1);

    // the closed form agrees with stepping the circuit in small trapezoid steps
    const h = 1e-4;
    let v = 0;
    for (let t = 0; t < tau - h / 2; t += h) {
      const i0 = (vFinal - v) / loop;
      const guess = v + (i0 * h) / farads;
      v += (((i0 + (vFinal - guess) / loop) / 2) * h) / farads;
    }
    nearest(v, atTau, 1e-3);
  });
});

describe("blinker-555", () => {
  const project = load("blinker-555");
  const r1 = partOf(project, "R1").param("ohms");
  const r2 = partOf(project, "R2").param("ohms");
  const farads = partOf(project, "C1").param("farads");
  const timer = partOf(project, "U2");
  const disOn = timer.rating("discharge_resistance");

  it("ties the 555 as an astable: trigger to threshold, reset to 5 V, R1 and R2 on the discharge pin", () => {
    expect(connections(project)).toEqual([
      ["C1.MINUS", "C2.P2", "LED1.K", "U1.GND", "U2.GND"],
      ["C1.PLUS", "R2.P2", "U2.THRES", "U2.TRIG"],
      ["C2.P1", "U2.CONT"],
      ["LED1.A", "R3.P2"],
      ["R1.P1", "U1.P5V", "U2.RESET", "U2.VCC"],
      ["R1.P2", "R2.P1", "U2.DISCH"],
      ["R3.P1", "U2.OUT"],
    ]);
  });

  it("blinks at about 1.05 Hz, half on and half off", () => {
    const on = high(r1, r2, farads);
    const off = low(r2, disOn, farads);
    expect(on).toBeCloseTo(0.478, 3);
    expect(off).toBeCloseTo(0.471, 3);
    expect(1 / (on + off)).toBeCloseTo(1.05, 2);
    expect(on / (on + off)).toBeCloseTo(0.5, 1);
    // the datasheet form 1.44 / ((R1 + 2 R2) C) is within a percent of it
    nearest(1.44 / ((r1 + 2 * r2) * farads), 1 / (on + off), 0.01);
  });

  it("swings the timing capacitor between one third and two thirds of 5 V, found by running the circuit", () => {
    const lo = SUPPLY / 3;
    const hi = (2 * SUPPLY) / 3;
    const h = 1e-5;
    let v = 0;
    let charging = true;
    const rises: number[] = [];
    for (let k = 1; k * h < 6; k++) {
      const toward = charging ? SUPPLY : 0;
      const tau = (charging ? r1 + r2 : r2 + disOn) * farads;
      v = toward + (v - toward) * Math.exp(-h / tau);
      if (charging && v >= hi) charging = false;
      else if (!charging && v <= lo) {
        charging = true;
        rises.push(k * h);
      }
    }
    // the first cycle starts from empty, so measure the later ones
    const periods = rises.slice(1).map((t, i) => t - rises[i]!);
    nearest(periods.at(-1)!, high(r1, r2, farads) + low(r2, disOn, farads), 2e-3);
    expect(lo).toBeCloseTo(1.667, 3);
    expect(hi).toBeCloseTo(3.333, 3);
  });

  it("drives the LED from an output that is high at about 4.2 V", () => {
    const led = partOf(project, "LED1");
    const drop = timer.rating("output_high_drop");
    const rOut = timer.rating("output_resistance");
    const loop = partOf(project, "R3").param("ohms") + rOut + led.rating("dynamic_resistance");
    const amps = (SUPPLY - drop - led.rating("forward_voltage_red", "typ")) / loop;
    expect(SUPPLY - drop - amps * rOut).toBeCloseTo(4.2, 1);
    expect(amps * 1000).toBeCloseTo(6.75, 1);
  });
});

describe("opamp-amplifier", () => {
  const project = load("opamp-amplifier");
  const amp = partOf(project, "U2");
  const pot = partOf(project, "POT1");

  it("is a non-inverting amplifier with the knob on pin 3 and the unused half tied off", () => {
    expect(connections(project)).toEqual([
      ["POT1.P1", "R2.P2", "U1.GND", "U2.IN2P", "U2.VEE"],
      ["POT1.P3", "U1.P5V", "U2.VCC"],
      ["POT1.W", "U2.IN1P"],
      ["R1.P1", "U2.OUT1"],
      ["R1.P2", "R2.P1", "U2.IN1N"],
      ["U2.IN2N", "U2.OUT2"],
    ]);
  });

  it("doubles the knob voltage: 1.0 V in, 2.0 V out", () => {
    const gain = 1 + partOf(project, "R1").param("ohms") / partOf(project, "R2").param("ohms");
    const a = amp.rating("open_loop_gain", "typ");
    const vin = SUPPLY * pot.param("pos");
    const vout = (vin * gain) / (1 + gain / a);
    expect(gain).toBe(2);
    expect(vin).toBeCloseTo(1, 6);
    expect(vout).toBeCloseTo(2, 3);
  });

  it("runs out of output 1.5 V below the 5 V supply, a third of the way up the knob", () => {
    const limit = SUPPLY - amp.rating("output_headroom", "max");
    expect(limit).toBe(3.5);
    // 2 x 5 V x position reaches the limit at 0.35 of the travel
    expect(limit / (2 * SUPPLY)).toBeCloseTo(0.35, 6);
  });
});

/** A half wave rectifier into a capacitor and a load, stepped finely with backward Euler: a source behind its own resistance, a diode that is off below `vf` and a line of slope 1/rd above. */
function halfWave(o: { vpk: number; hz: number; rs: number; vf: number; rd: number; esr: number; c: number; rl: number }) {
  const h = 2e-6;
  const ron = o.rs + o.rd + o.esr;
  const g = h / o.c;
  let vo = 0;
  const out: { t: number; v: number }[] = [];
  for (let k = 1; k * h <= 0.5; k++) {
    const t = k * h;
    const vs = o.vpk * Math.sin(2 * Math.PI * o.hz * t);
    const on = (vo + (g * (vs - o.vf)) / ron) / (1 + g * (1 / ron + 1 / o.rl));
    vo = (vs - o.vf - on) / ron > 0 ? on : vo / (1 + g / o.rl);
    out.push({ t, v: vo });
  }
  return out;
}

describe("rectifier", () => {
  const project = load("rectifier");

  it("puts the diode between the source and the capacitor, which sits across the load", () => {
    expect(connections(project)).toEqual([
      ["C1.MINUS", "R1.P2", "SIG1.NEG", "U1.GND"],
      ["C1.PLUS", "D1.K", "R1.P1"],
      ["D1.A", "SIG1.POS"],
    ]);
  });

  it("holds the peaks near 3.4 V with about 0.5 V of ripple", () => {
    const sig = partOf(project, "SIG1");
    const diode = partOf(project, "D1");
    const out = halfWave({
      vpk: sig.param("amplitude_v"),
      hz: sig.param("hz"),
      rs: sig.rating("output_resistance"),
      vf: diode.rating("forward_voltage_solver"),
      rd: diode.rating("dynamic_resistance"),
      esr: partOf(project, "C1").rating("esr"),
      c: partOf(project, "C1").param("farads"),
      rl: partOf(project, "R1").param("ohms"),
    });
    const settled = out.filter((s) => s.t > 0.4).map((s) => s.v);
    const peak = Math.max(...settled);
    const ripple = peak - Math.min(...settled);
    expect(peak).toBeCloseTo(3.4, 1);
    expect(ripple).toBeCloseTo(0.5, 1);
    // never negative: the diode took the negative half away
    expect(out.reduce((low, s) => Math.min(low, s.v), Infinity)).toBeGreaterThanOrEqual(0);
  });
});

describe("zener-regulator", () => {
  const project = load("zener-regulator");
  const sig = partOf(project, "SIG1");
  const zener = partOf(project, "ZD1");
  const r1 = partOf(project, "R1").param("ohms");
  const r2 = partOf(project, "R2").param("ohms");
  const junction = {
    kind: "shockley" as const,
    isAmps: zener.rating("saturation_current"),
    n: zener.d.behaviour.layers[0]!.model.kind === "element" ? Number(zener.d.behaviour.layers[0]!.model.params?.n?.value) : NaN,
    rsOhms: 0,
    rzOhms: zener.rating("dynamic_resistance"),
    vbrVolts: zener.rating("breakdown_voltage"),
  };

  /** The output and the Zener current with the source at `vin`, by the Newton solver. */
  function at(vin: number) {
    const elements: Element[] = [
      { id: "V1", kind: "V", a: 1, b: 0, volts: vin, rSeriesOhms: sig.rating("output_resistance") },
      { id: "R1", kind: "R", a: 1, b: 2, ohms: r1 },
      { id: "R2", kind: "R", a: 2, b: 0, ohms: r2 },
      { id: "ZD1", kind: "D", a: 0, b: 2, modelId: "zener", vf: 0.7, rdOhms: 0.2, maxAmps: 0.178, junction },
    ];
    const result = solve({ nodes: 3, ground: 0, elements }, { ...PWL_OPTIONS, mode: "newton", reltol: 1e-9 });
    expect(result.converged).toBe(true);
    return { vout: result.v[2]!, zenerAmps: -result.branch.ZD1!.amps, watts: result.branch.ZD1!.watts };
  }

  it("has the Zener across the load with its band on the output side", () => {
    expect(connections(project)).toEqual([
      ["R1.P1", "SIG1.POS"],
      ["R1.P2", "R2.P1", "ZD1.K"],
      ["R2.P2", "SIG1.NEG", "U1.GND", "ZD1.A"],
    ]);
  });

  it("sweeps the input from 0 V to 12 V", () => {
    expect(sig.param("offset_v") - sig.param("amplitude_v")).toBe(0);
    expect(sig.param("offset_v") + sig.param("amplitude_v")).toBe(12);
  });

  it("is a divider below the knee: 3 V in gives about 2.2 V out", () => {
    const { vout, zenerAmps } = at(3);
    expect(vout).toBeCloseTo((3 * r2) / (r2 + r1 + sig.rating("output_resistance")), 2);
    expect(vout).toBeCloseTo(2.2, 1);
    expect(Math.abs(zenerAmps)).toBeLessThan(1e-6);
  });

  it("holds the output near 4.8 V at 12 V in, with about 14 mA in the Zener", () => {
    const { vout, zenerAmps, watts } = at(12);
    expect(vout).toBeCloseTo(4.8, 1);
    expect(zenerAmps * 1000).toBeCloseTo(14, 0);
    // under its quoted 5.1 V because 14 mA is well under the 49 mA that voltage is measured at
    expect(vout).toBeLessThan(zener.rating("zener_voltage"));
    expect(watts).toBeLessThan(zener.rating("power_total") / 10);
  });

  it("gives the quoted 5.1 V at the test current", () => {
    const amps = zener.d.ratings.test_current!.manufacturer!.value!;
    const { isAmps, n, rzOhms, vbrVolts } = junction;
    const nvt = n * 0.025852;
    // reverse junction voltage that carries the test current, plus the drop in the series resistance
    const volts = vbrVolts + nvt * Math.log(amps / isAmps) + amps * rzOhms;
    expect(volts).toBeCloseTo(zener.rating("zener_voltage"), 1);
  });

  it("moves the output by about 0.1 V while the input moves from 8 V to 12 V", () => {
    expect(at(12).vout - at(8).vout).toBeLessThan(0.2);
  });
});
