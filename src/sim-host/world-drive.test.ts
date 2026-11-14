// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "@/parts/builtin";
import type { Project } from "@/project/generated/types";
import { buildSimNetlist } from "@/sim/netlist";
import { inputDrives } from "./world-drive";

function starter(name: string) {
  const doc = JSON.parse(readFileSync(`src/studio/starters/${name}.project.json`, "utf8")) as Project;
  return { doc, net: buildSimNetlist(doc, builtinRegistry()).net, input: doc.simulation.world.inputs[0] };
}

describe("inputDrives", () => {
  it("puts a knob at the voltage its position stands for, on the pin the wiper is wired to, and turns the potentiometer", () => {
    const { net, input } = starter("knob");
    const pot = net.parts.find((p) => p.kind === "pot")!.id;
    expect(inputDrives(net, input, 0)).toEqual([{ kind: "param", target: pot, value: { path: "pos", value: 0 } }, { kind: "analog", target: "A0", value: 0 }]);
    expect(inputDrives(net, input, 1023)).toEqual([{ kind: "param", target: pot, value: { path: "pos", value: 1 } }, { kind: "analog", target: "A0", value: 5 }]);
    const [, mid] = inputDrives(net, input, 620);
    expect(mid.value).toBeCloseTo((620 / 1023) * 5, 6);
  });

  it("holds a pressed button at the pin level the wiring makes it, and lets go on release", () => {
    const { net, input } = starter("button");
    expect(input.device).toMatchObject({ kind: "button", pull: "external-down" });
    expect(inputDrives(net, input, 1)).toEqual([{ kind: "pin", target: "D2", value: 1 }]);
    expect(inputDrives(net, input, 0)).toEqual([{ kind: "pin", target: "D2", value: 0 }]);
  });

  it("drives a light sensor through its divider, brighter giving more volts", () => {
    const { net, input } = starter("light");
    const [dark, bright] = [inputDrives(net, input, 0), inputDrives(net, input, 1000)];
    expect(dark[0]).toMatchObject({ kind: "analog", target: "A0" });
    expect(bright[0].value as number).toBeGreaterThan(dark[0].value as number);
  });

  it("drives no pin for an input that is not wired to a board pin", () => {
    const { net, input } = starter("knob");
    expect(inputDrives(net, { ...input, pins: [] }, 100).map((d) => d.kind)).toEqual(["param"]);
  });
});
