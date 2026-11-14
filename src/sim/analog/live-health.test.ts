// @vitest-environment node
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "../../parts/builtin.ts";
import { StateHasher } from "../core/hash.ts";
import type { DigitalLayer, SimNetlist, SimPart, SimRunOptions, SliceBudget } from "../engine.ts";
import { createOrchestrator } from "../orchestrator.ts";
import { createRunAnalog } from "./run.ts";

const parts = builtinRegistry();
const BUDGET: SliceBudget = { shouldYield: () => false, work: { statements: Infinity, events: Infinity, outputBytes: Infinity } };
const OPTS: SimRunOptions = { seed: 1, speed: 1, limits: { statements: 1e6, events: 1e6, outputBytes: 1e6 }, tier: "T1" };
const DIGITAL: DigitalLayer = { load: () => [], onPin: () => undefined, partStates: () => [], stateHash: () => new StateHasher().hex() };

/** One part between a bench supply and ground. `volts` is what the supply puts on the part's first pin. */
function bench(part: Pick<SimPart, "descriptor" | "params" | "pins" | "kind">, volts: number) {
  const net: SimNetlist = {
    version: 1,
    docHash: "t",
    nets: [...new Set(["gnd", "n1", ...Object.values(part.pins).filter((n): n is string => n !== null)])].map((id) => ({ id })),
    ground: "gnd",
    parts: [{ id: "X1", ...part }],
    settings: { seed: 1, toleranceMode: "nominal", analog: { mode: "transient", stepNs: 1_000_000 }, speed: 1 },
  };
  const live = createRunAnalog(parts);
  const orch = createOrchestrator({ engines: [], digital: DIGITAL, analog: live });
  orch.load(net, OPTS);
  expect(orch.setInstrument("ps1", { kind: "psu", pos: "n1", neg: "gnd", volts, limitAmps: 1 })).toEqual({ ok: true });
  const stateAt = (seconds: number) => {
    orch.runUntil(Math.round(seconds * 1e9), BUDGET);
    return live.readout().parts.get("X1")?.state;
  };
  const why = () => live.readout().parts.get("X1")?.why;
  return { stateAt, why };
}

const electrolytic = (rated: number) => ({
  descriptor: "core.capacitor-electrolytic@1.0.0",
  params: { farads: 1e-4, rated_volts: rated },
  pins: { PLUS: "n1", MINUS: "gnd" },
  kind: "other" as const,
});

describe("a capacitor and an inductor in the live solver", () => {
  it("burns an electrolytic fed more than its rated voltage", () => {
    expect(bench(electrolytic(16), 20).stateAt(0.05)).toBe("burnt");
  });

  it("says why a part burnt: the message and the numbers it names", () => {
    const over = bench(electrolytic(16), 20);
    expect(over.why()).toBeUndefined();
    over.stateAt(0.05);
    expect(over.why()).toEqual({ key: "fidelity.states.capacitorOver", args: { name: "X1", v: expect.any(Number), rated: 16 } });
  });

  it("leaves an electrolytic alone within its rating", () => {
    expect(bench(electrolytic(16), 5).stateAt(0.2)).toBe("ok");
  });

  it("reads reversed at once and burns a polarised capacitor held the wrong way round for half a second", () => {
    const wrongWay = bench(electrolytic(16), -5);
    expect(wrongWay.stateAt(0.1)).toBe("reversed");
    expect(wrongWay.stateAt(0.8)).toBe("burnt");
  });

  it("burns an inductor carrying more than twice its rated current", () => {
    const inductor = { descriptor: "core.inductor@1.0.0", params: { henries: 1e-3 }, pins: { P1: "n1", P2: "gnd" }, kind: "other" as const };
    expect(bench(inductor, 5).stateAt(0.05)).toBe("burnt");
  });
});

const lm358 = (pins: Record<string, string>) => ({ descriptor: "core.lm358@1.0.0", params: {}, pins, kind: "other" as const });
const ne555 = (pins: Record<string, string>) => ({ descriptor: "core.ne555@1.0.0", params: {}, pins, kind: "other" as const });

describe("an op-amp and a 555 in the live solver", () => {
  // the output is asked to go high into a short to ground
  const shortedAmp = lm358({ VCC: "n1", VEE: "gnd", IN1P: "n1", IN1N: "gnd", OUT1: "gnd" });
  const shortedTimer = ne555({ GND: "gnd", VCC: "n1", RESET: "n1", TRIG: "gnd", THRES: "gnd", OUT: "gnd", CONT: "ctrl", DISCH: "dis" });

  it("burns an LM358 on more than the 32 V its sheet allows, and not on 20 V", () => {
    const pins = { VCC: "n1", VEE: "gnd", IN1P: "gnd", IN1N: "gnd", OUT1: "out" };
    expect(bench(lm358(pins), 40).stateAt(0.01)).toBe("burnt");
    expect(bench(lm358(pins), 20).stateAt(0.01)).toBe("ok");
  });

  it("says why: the supply it saw and the rating", () => {
    const over = bench(lm358({ VCC: "n1", VEE: "gnd", IN1P: "gnd", IN1N: "gnd", OUT1: "out" }), 40);
    over.stateAt(0.01);
    expect(over.why()).toEqual({ key: "fidelity.states.opampSupply", args: { name: "X1", v: 40, rated: 32 } });
  });

  it("burns an LM358 whose output is held into a short past 60 mA for 100 ms, and not before", () => {
    const short = bench(shortedAmp, 5);
    expect(short.stateAt(0.05)).toBe("hot");
    expect(short.stateAt(0.3)).toBe("burnt");
    expect(short.why()).toMatchObject({ key: "fidelity.states.opampOutput", args: { rated: 60 } });
  });

  it("burns an NE555 on more than 18 V, and not on 15 V", () => {
    const pins = { GND: "gnd", VCC: "n1", RESET: "n1", TRIG: "n1", THRES: "gnd", OUT: "out", CONT: "ctrl", DISCH: "dis" };
    expect(bench(ne555(pins), 20).stateAt(0.01)).toBe("burnt");
    expect(bench(ne555(pins), 15).stateAt(0.01)).toBe("ok");
  });

  it("burns an NE555 that drives a short past 225 mA for 100 ms", () => {
    const short = bench(shortedTimer, 5);
    expect(short.stateAt(0.3)).toBe("burnt");
    expect(short.why()).toMatchObject({ key: "fidelity.states.timerOutput", args: { rated: 225 } });
  });
});
