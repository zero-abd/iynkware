// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "../../parts/builtin.ts";
import type { Project } from "../../project/generated/types.ts";
import { buildSimNetlist } from "../netlist.ts";
import { minSupplyV, railsOf } from "./rails.ts";
import type { ComponentDescriptor } from "./ports.ts";

const registry = builtinRegistry();
const describe_ = (ref: string) => registry.latest(ref);

const railsOfTemplate = (name: string, logicV = 5) => {
  const doc = JSON.parse(readFileSync(`content/projects/robots/${name}.project.json`, "utf8")) as Project;
  return railsOf(buildSimNetlist(doc, registry).net, describe_, logicV);
};

const rated = (role: string, scope: string[], slot: Record<string, unknown>, used = "none") =>
  ({ measure: "voltage", role, scope: { pins: scope }, [used === "simulation" ? "simulation" : "manufacturer"]: { unit: "V", ...slot }, used_by_model: used });

const part = (ratings: Record<string, unknown>) => ({ ratings }) as unknown as ComponentDescriptor;

describe("minSupplyV", () => {
  it("takes the highest operating or recommended minimum on the pins", () => {
    const d = part({ a: rated("operating", ["VCC"], { min: 2.7 }), b: rated("recommended", ["VCC"], { min: 4.5 }), c: rated("operating", ["VM"], { min: 9 }) });
    expect(minSupplyV(d, ["VCC"])).toBe(4.5);
    expect(minSupplyV(d, ["VM"])).toBe(9);
  });

  it("falls back to the brown-out threshold, and ignores maxima and other pins", () => {
    const d = part({ t: rated("threshold", ["P5V"], { value: 2.7 }, "simulation"), m: rated("abs_max", ["P5V"], { max: 6 }) });
    expect(minSupplyV(d, ["P5V"])).toBe(2.7);
    expect(minSupplyV(d, ["GND"])).toBeUndefined();
  });

  it("is unknown for a rating with no minimum", () => {
    expect(minSupplyV(part({ a: rated("operating", ["VCC"], { max: 5.5 }) }), ["VCC"])).toBeUndefined();
  });
});

describe("railsOf on the shipped robots", () => {
  it("reads the rail minimum from the parts on the rail, so the line sensor's 3.3 V outranks the board's 2.7 V", () => {
    expect(railsOfTemplate("line-follower").logicMin).toEqual({ v: 3.3, part: "cmp_qtr" });
    expect(railsOfTemplate("drive-base").logicMin).toEqual({ v: 2.7, part: "brd_uno" });
  });

  it("takes the pack minimum from the cut-off of two LiPo cells, which is above what the driver declares", () => {
    expect(railsOfTemplate("line-follower").packMin).toEqual({ v: 6.4, part: "cmp_bat" });
  });

  it("finds the pack feeding the board's VIN, and the rail on its 5 V pin", () => {
    const { nets, regulator } = railsOfTemplate("line-follower");
    expect(nets.pack).toBe(nets.regulator);
    expect(nets.pack).not.toBe(nets.rail);
    expect(nets.rail).not.toBe("");
    expect(regulator).toMatchObject({ model: { kind: "linear", voutVolts: 5, dropoutVolts: 1.2 }, described: true });
  });

  it("looks for the 3.3 V pin on a 3.3 V board, which the robot does not wire", () => {
    expect(railsOfTemplate("line-follower", 3.3).nets.rail).toBe("");
  });
});
