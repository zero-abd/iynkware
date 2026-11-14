// @vitest-environment node
import { expect, it } from "vitest";
import { builtinRegistry } from "../../parts/builtin.ts";
import { StateHasher } from "../core/hash.ts";
import type { DigitalLayer, SimNetlist, SimPart, SimRunOptions } from "../engine.ts";
import { createOrchestrator } from "../orchestrator.ts";
import { createRunAnalog } from "./run.ts";

const parts = builtinRegistry();
const OPTS: SimRunOptions = { seed: 1, speed: 1, limits: { statements: 1e6, events: 1e6, outputBytes: 1e6 }, tier: "T1" };
const DIGITAL: DigitalLayer = { load: () => [], onPin: () => undefined, partStates: () => [], stateHash: () => new StateHasher().hex() };
const unwired = (id: string, descriptor: string, pins: string[]): SimPart => ({ id, descriptor, params: {}, pins: Object.fromEntries(pins.map((p) => [p, null])), kind: "other" });

it("runs a circuit with parts placed but not wired yet, a 555 and a Zener among them", () => {
  const net: SimNetlist = {
    version: 1,
    docHash: "t",
    nets: [{ id: "gnd" }, { id: "vb" }],
    ground: "gnd",
    parts: [
      { id: "bat", descriptor: "core.aa-holder-4@1.0.0", params: {}, pins: { PLUS: "vb", MINUS: "gnd" }, kind: "other" },
      { id: "r", descriptor: "core.resistor@1.0.0", params: { ohms: 1000 }, pins: { P1: "vb", P2: "gnd" }, kind: "resistor" },
      unwired("t", "core.ne555@1.0.0", ["GND", "TRIG", "OUT", "RESET", "CONT", "THRES", "DISCH", "VCC"]),
      unwired("z", "core.zener-1n4733a@1.0.0", ["A", "K"]),
      unwired("oa", "core.lm358@1.0.0", ["OUT1", "IN1N", "IN1P", "VEE", "IN2P", "IN2N", "OUT2", "VCC"]),
    ],
    settings: { seed: 1, toleranceMode: "nominal", analog: { mode: "dc-event" }, speed: 1 },
  };
  const live = createRunAnalog(parts);
  const loaded = createOrchestrator({ engines: [], digital: DIGITAL, analog: live }).load(net, OPTS);
  expect(loaded.ok).toBe(true);
  expect(live.netVolts("vb")).toBeGreaterThan(5);
});
