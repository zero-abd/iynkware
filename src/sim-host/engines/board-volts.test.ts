// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "@/parts/builtin";
import type { Project } from "@/project/generated/types";
import { createDigitalNets } from "@/sim/digital/nets";
import type { SimRunOptions, SliceBudget } from "@/sim/engine";
import { buildSimNetlist } from "@/sim/netlist";
import { createOrchestrator } from "@/sim/orchestrator";
import { inputDrives } from "../world-drive";
import { boardNetVolts } from "./board-volts";
import { createInterpEngine } from "./interp-engine";

const MS = 1_000_000;
const BUDGET: SliceBudget = { shouldYield: () => false, work: { statements: Infinity, events: Infinity, outputBytes: Infinity } };
const OPTS: SimRunOptions = { seed: 1, speed: 1, limits: { statements: 4_000_000, events: 100_000, outputBytes: 65_536 }, tier: "T1" };

function knobRun() {
  const doc = JSON.parse(readFileSync("src/studio/starters/knob.project.json", "utf8")) as Project;
  const { net } = buildSimNetlist(doc, builtinRegistry());
  const source = doc.sources.find((s) => s.role === "firmware")!;
  const engine = createInterpEngine({ id: "mcu", board: "uno-r3", language: "arduino", seed: 1 });
  expect(engine.load({ kind: "source", language: "arduino-cpp", files: [{ path: source.path, text: source.content }], entry: source.path }).ok).toBe(true);
  const orch = createOrchestrator({ engines: [engine], digital: createDigitalNets() });
  expect(orch.load(net, OPTS).ok).toBe(true);
  const knob = doc.simulation.world.inputs[0];
  const turn = (value: number) => inputDrives(net, knob, value).forEach((drive) => orch.inject(drive));
  const readings = () => engine.serialLog.map((l) => l.text.trim()).filter(Boolean);
  const netOf = (pin: string) => net.parts.find((p) => p.kind === "board")!.pins[pin]!;
  return { net, engine, orch, turn, readings, netOf };
}

describe("a knob on the potentiometer starter", () => {
  it("reads steady at the value it is put at, and follows when it is turned", () => {
    const { orch, turn, readings } = knobRun();
    turn(620);
    orch.runUntil(500 * MS, BUDGET);
    expect(new Set(readings())).toEqual(new Set(["620"]));
    turn(1023);
    orch.runUntil(1000 * MS, BUDGET);
    expect(readings().at(-1)).toBe("1023");
    turn(0);
    orch.runUntil(1500 * MS, BUDGET);
    expect(readings().at(-1)).toBe("0");
  });

  it("shows on a meter: the wiper net at the knob's voltage, the supply and ground at theirs", () => {
    const { net, engine, orch, turn, netOf } = knobRun();
    const volts = boardNetVolts(net, engine);
    turn(620);
    orch.runUntil(200 * MS, BUDGET);
    expect(volts(netOf("A0"))).toBeCloseTo((620 / 1023) * 5, 6);
    expect(volts(netOf("P5V"))).toBe(5);
    expect(volts(netOf("GND"))).toBe(0);
    expect(volts(netOf("D9"))).toBeGreaterThan(0);
  });

  it("reads null on a net with no board pin on it, so the meter says it is not modelled", () => {
    const { net, engine } = knobRun();
    const loose = net.nets.find((n) => !net.parts.some((p) => p.kind === "board" && Object.values(p.pins).includes(n.id)));
    expect(loose).toBeDefined();
    expect(boardNetVolts(net, engine)(loose!.id)).toBeNull();
  });
});
