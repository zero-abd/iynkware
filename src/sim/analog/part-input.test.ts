// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SimNetlist, SimPart } from "../engine.ts";
import { allEntries, loadRegistry } from "../registry/entries.ts";
import { PWL_OPTIONS } from "./elements.ts";
import { createLiveAnalog } from "./live.ts";
import { partInputChanges } from "./part-input.ts";
import { solve } from "./solve.ts";

const part = (id: string, descriptor: string, pins: Record<string, string>, params: SimPart["params"] = {}): SimPart => ({ id, descriptor, params, pins, kind: "other" });
const ohms = (id: string, a: string, b: string, value: number) => part(id, "resistor", { P1: a, P2: b }, { ohms: value });

const net: SimNetlist = {
  version: 1,
  docHash: "h",
  nets: ["n5", "gnd", "ns", "nb", "nw"].map((id) => ({ id })),
  ground: "gnd",
  settings: { seed: 1, toleranceMode: "nominal", analog: { mode: "dc-event", stepNs: 1000 }, speed: 0 },
  parts: [
    { ...part("u1", "uno-r3", { P5V: "n5", GND: "gnd" }), kind: "board" },
    part("sw", "slide-switch", { A: "n5", COM: "ns", B: "gnd" }),
    ohms("rs", "ns", "gnd", 10000),
    part("btn", "push-button-6mm", { P1: "n5", P2: "n5", P3: "nb", P4: "nb" }),
    ohms("rb", "nb", "gnd", 10000),
    part("pot", "potentiometer-10k", { P1: "n5", W: "nw", P3: "gnd" }, { ohms: 10000, pos: 0.5 }),
    ohms("rw", "nw", "gnd", 1e7),
  ],
};

function started() {
  const live = createLiveAnalog({
    solve,
    registry: loadRegistry(allEntries()),
    pins: (p) => (p.kind === "board" ? { rOutOhms: 25, maxAmps: 0.04, vilFrac: 0.3, vihFrac: 0.6, logicVolts: 5, source: "avr-typical" } : null),
    power: () => null,
  });
  live.load(net, PWL_OPTIONS);
  live.advanceTo(0);
  const set = (descriptor: string, id: string, param: string, value: number) => {
    live.apply(partInputChanges(descriptor, id, param, value)!);
    live.advanceTo(1);
  };
  return { live, set };
}

describe("partInputChanges", () => {
  it("knows the three inputs and nothing else", () => {
    expect(partInputChanges("push-button-6mm", "b", "pressed", 1)).toEqual([{ kind: "switch", element: "b", closed: true }]);
    expect(partInputChanges("core.slide-switch", "s", "closed", 1)).toEqual([
      { kind: "switch", element: "s:A", closed: false },
      { kind: "switch", element: "s:B", closed: true },
    ]);
    expect(partInputChanges("potentiometer-10k", "p", "pos", 1.5)).toEqual([{ kind: "param", element: "p", path: "pos", value: 1 }]);
    expect(partInputChanges("push-button-6mm", "b", "closed", 1)).toBeNull();
    expect(partInputChanges("resistor", "r", "pressed", 1)).toBeNull();
    expect(partInputChanges(undefined, "x", "pos", 1)).toBeNull();
  });
});

describe("run-time inputs in the live solver", () => {
  it("pressing a button joins its pairs and releasing opens them", () => {
    const { live, set } = started();
    expect(live.netVolts("nb")).toBeCloseTo(0, 1);
    set("push-button-6mm", "btn", "pressed", 1);
    expect(live.netVolts("nb")).toBeGreaterThan(4.5);
    set("push-button-6mm", "btn", "pressed", 0);
    expect(live.netVolts("nb")).toBeCloseTo(0, 1);
  });

  it("flipping a slide switch moves the common from one end to the other", () => {
    const { live, set } = started();
    expect(live.netVolts("ns")).toBeGreaterThan(4.5);
    set("slide-switch", "sw", "closed", 1);
    expect(live.netVolts("ns")).toBeCloseTo(0, 1);
    set("slide-switch", "sw", "closed", 0);
    expect(live.netVolts("ns")).toBeGreaterThan(4.5);
  });

  it("turning a pot moves the wiper voltage", () => {
    const { live, set } = started();
    expect(live.netVolts("nw")).toBeCloseTo(2.5, 1);
    set("potentiometer-10k", "pot", "pos", 0.25);
    expect(live.netVolts("nw")).toBeCloseTo(3.75, 1);
    set("potentiometer-10k", "pot", "pos", 1);
    expect(live.netVolts("nw")).toBeCloseTo(0, 1);
  });
});
