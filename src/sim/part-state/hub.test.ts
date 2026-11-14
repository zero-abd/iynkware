// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createDigitalNets } from "../digital/nets.ts";
import type { SimNetlist } from "../engine.ts";
import { createPartStates } from "./hub.ts";
import { PROVIDERS } from "./index.ts";
import type { PartStateProvider } from "./types.ts";

function netlist(): SimNetlist {
  return {
    version: 1,
    docHash: "x",
    nets: [{ id: "n:sig" }, { id: "n:gnd" }, { id: "n:d9" }],
    ground: "n:gnd",
    parts: [
      { id: "brd", descriptor: "core.uno-r3@1.0.0", params: {}, pins: { D9: "n:d9", GND: "n:gnd" }, kind: "board" },
      { id: "s1", descriptor: "core.servo-sg90@1.0.0", params: {}, pins: { SIG: "n:d9", GND: "n:gnd", VPLUS: null }, kind: "other" },
      { id: "x1", descriptor: "core.mystery@1.0.0", params: {}, pins: { A: "n:sig" }, kind: "other" },
      { id: "u1", descriptor: "core.thing@1.0.0", params: { n: 2 }, pins: { A: "n:sig" }, kind: "other" },
    ],
    settings: { seed: 1, toleranceMode: "nominal", analog: {} as never, speed: 1 },
  };
}

const digital = () => {
  const d = createDigitalNets();
  d.load(netlist());
  return d;
};

describe("part state hub", () => {
  it("lists the shipped providers under their catalogue names", () => {
    expect(Object.keys(PROVIDERS)).toEqual(expect.arrayContaining(["servo-sg90", "dc-motor"]));
  });

  it("asks only the parts that have a provider and adds their id to the answer", () => {
    const seen: string[] = [];
    const reading: PartStateProvider = (ctx) => {
      seen.push(ctx.part.id);
      return { kind: "reading", value: ctx.at, unit: "ns", label: "t" };
    };
    const hub = createPartStates(netlist(), { digital: digital(), live: null }, { thing: reading });
    expect(hub.states(5)).toEqual([{ part: "u1", kind: "reading", value: 5, unit: "ns", label: "t" }]);
    expect(seen).toEqual(["u1"]);
  });

  it("keeps a part's memory from frame to frame and apart from other parts", () => {
    const count: PartStateProvider = (ctx) => {
      ctx.memory.n = (ctx.memory.n ?? 0) + 1;
      return { kind: "reading", value: ctx.memory.n, unit: "", label: "" };
    };
    const hub = createPartStates(netlist(), { digital: digital(), live: null }, { thing: count, "servo-sg90": count });
    hub.states(1);
    expect(hub.states(2).map((s) => (s as { value: number }).value)).toEqual([2, 2]);
  });

  it("gives a provider the pin signal and no solver numbers when there is no solver", () => {
    let got: unknown[] = [];
    const probe: PartStateProvider = (ctx) => {
      got = [ctx.signal("SIG")?.servoUs, ctx.volts("SIG"), ctx.amps(), ctx.health(), ctx.net("VPLUS"), ctx.across("SIG", "GND")];
      return null;
    };
    const d = digital();
    d.onPin("D9", 0, undefined, 10, { servoUs: 1500 });
    createPartStates(netlist(), { digital: d, live: null }, { "servo-sg90": probe }).states(10);
    expect(got).toEqual([1500, null, null, null, null, null]);
  });

  it("drops a part whose provider throws and still answers for the others", () => {
    const boom: PartStateProvider = () => {
      throw new Error("bad part");
    };
    const ok: PartStateProvider = () => ({ kind: "reading", value: 1, unit: "V", label: "" });
    const hub = createPartStates(netlist(), { digital: digital(), live: null }, { "servo-sg90": boom, thing: ok });
    expect(hub.states(0).map((s) => s.part)).toEqual(["u1"]);
  });

  it("gives a part on a PCA9685 output the pulse the chip makes on that channel", () => {
    const net = netlist();
    net.nets.push({ id: "n:ch3" });
    net.parts.push(
      { id: "pwm", descriptor: "core.pca9685-module@1.0.0", params: {}, pins: { PWM3: "n:ch3", GND: "n:gnd" }, kind: "other" },
      { id: "s2", descriptor: "core.servo-sg90@1.0.0", params: {}, pins: { SIG: "n:ch3", GND: "n:gnd", VPLUS: null }, kind: "other" },
    );
    const d = createDigitalNets();
    d.load(net);
    const chip = { hz: 50, duty: (ch: number) => (ch === 3 ? 0.075 : 0) };
    let seen: unknown = null;
    const probe: PartStateProvider = (ctx) => {
      if (ctx.part.id === "s2") seen = ctx.signal("SIG");
      return null;
    };
    createPartStates(net, { digital: d, live: null, pwmDrivers: () => [chip] }, { "servo-sg90": probe }).states(1);
    expect(seen).toMatchObject({ servoUs: 1500, duty: 0.075, hz: 50, level: 1 });
    createPartStates(net, { digital: d, live: null, pwmDrivers: () => [] }, { "servo-sg90": probe }).states(1);
    expect(seen).toMatchObject({ servoUs: null });
  });
});
