// @vitest-environment node
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "@/parts/builtin";
import type { Project } from "@/project/generated/types";
import { createRunAnalog } from "@/sim/analog/run";
import { createDigitalNets } from "@/sim/digital/nets";
import type { SimRunOptions, SliceBudget } from "@/sim/engine";
import { buildSimNetlist } from "@/sim/netlist";
import { createOrchestrator } from "@/sim/orchestrator";
import blink from "@/studio/starters/blink.project.json";
import { createAnalogFrames } from "./analog-frame";
import { bindAnalog } from "./engines/bind";
import { createInterpEngine } from "./engines/interp-engine";
import { getProfile } from "@/sim/boards/profiles";

const MS = 1_000_000;
const BUDGET: SliceBudget = { shouldYield: () => false, work: { statements: Infinity, events: Infinity, outputBytes: Infinity } };
const OPTS: SimRunOptions = { seed: 1, speed: 1, limits: { statements: 4_000_000, events: 100_000, outputBytes: 65_536 }, tier: "T1" };

const SKETCH = `void setup() { pinMode(13, OUTPUT); digitalWrite(13, HIGH); }
void loop() { Serial.println(analogRead(A0)); delay(100); }
`;

function start(sketch: string) {
  const project = blink as unknown as Project;
  const reg = builtinRegistry();
  const { net } = buildSimNetlist(project, reg);
  const live = createRunAnalog(reg);
  const engine = createInterpEngine({ id: "mcu", board: "uno-r3", language: "arduino", seed: 1 });
  const orch = createOrchestrator({ engines: [engine], digital: createDigitalNets(), analog: live });
  expect(orch.load(net, OPTS).ok).toBe(true);
  expect(engine.load({ kind: "source", language: "arduino-cpp", files: [{ path: "main", text: sketch }], entry: "main" }).ok).toBe(true);
  bindAnalog(engine, live, "brd_main", getProfile("uno-r3"));
  return { net, live, orch, engine };
}

describe("the live solver in a run", () => {
  it("puts the LED current of an Uno pin through a resistor on the meter's branch", () => {
    const { live, orch } = start(SKETCH);
    orch.runUntil(20 * MS, BUDGET);
    const ohms = 220;
    const amps = live.readout().amps.get("cmp_led1");
    expect(amps).toBeGreaterThan(0);
    expect(amps!).toBeCloseTo(3 / (ohms + 25.5), 3);
  });

  it("carries volts, amps, power and health in a full frame and then only what moved", () => {
    const { live, orch } = start(SKETCH);
    orch.runUntil(20 * MS, BUDGET);
    const frames = createAnalogFrames({ readout: () => live.readout(), samples: () => null });
    frames.watch({ volts: "all", amps: "all", pinAmps: true, waves: [] });
    const first = frames.frame(orch.now)!;
    expect(first.full).toBe(true);
    expect(first.parts!.cmp_led1.state).toBe("ok");
    expect(first.parts!.cmp_led1.watts).toBeGreaterThan(0);
    expect(first.pinAmps!.cmp_led1).toBeDefined();
    expect(frames.frame(orch.now)).toBeNull();
  });

  it("is deterministic: two runs give the same checkpoints", () => {
    const hashes = () => {
      const { orch } = start(SKETCH);
      orch.runUntil(2000 * MS, BUDGET);
      return orch.checkpoints.map((c) => c.hash);
    };
    expect(hashes()).toEqual(hashes());
  });
});
