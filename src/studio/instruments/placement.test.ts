// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Project } from "@/project/generated/types";
import { buildSimNetlist, groundOf } from "@/sim/netlist";
import { builtinRegistry } from "@/parts/builtin";
import { listProbePoints, netChoices, nodeIdOf } from "./placement";

const knob = () => JSON.parse(readFileSync("src/studio/starters/knob.project.json", "utf8")) as Project;

describe("listProbePoints", () => {
  const points = listProbePoints(knob());

  it("leaves out the holes of the breadboard", () => {
    expect(points.some((p) => /^BB\d/.test(p.label))).toBe(false);
    expect(points.length).toBeLessThan(60);
  });

  it("lists the named nets first, then the pins of each part by reference designator", () => {
    const firstPin = points.findIndex((p) => p.part !== null);
    expect(points.slice(0, firstPin).every((p) => p.part === null && p.id.startsWith("net:"))).toBe(true);
    expect(points.slice(firstPin).some((p) => p.part === null)).toBe(false);
    const parts = [...new Set(points.slice(firstPin).map((p) => p.part))];
    expect(parts).toEqual(expect.arrayContaining(["LED1", "POT1", "RES1"]));
    expect(parts).toEqual([...parts].sort((a, b) => a!.localeCompare(b!, undefined, { numeric: true })));
  });

  it("gives a pin its net, so a meter on it has something to read", () => {
    const wiper = points.find((p) => p.id === "pin:cmp_pot1.W");
    expect(wiper).toMatchObject({ part: "POT1", label: "POT1 W (A0)", target: { net: "net_a0", component: "cmp_pot1" } });
  });
});

describe("nodeIdOf", () => {
  it("names the simulator's node for a net, which is what a probe has to be asked for", () => {
    const doc = knob();
    const { net } = buildSimNetlist(doc, builtinRegistry());
    const node = nodeIdOf(doc).ofNet("net_a0");
    expect(node).toBeDefined();
    expect(net.nets.map((n) => n.id)).toContain(node);
    expect(net.parts.find((p) => p.kind === "board")!.pins.A0).toBe(node);
  });

  it("has no node for a missing net", () => {
    expect(nodeIdOf(knob()).ofNet("net_nope")).toBeUndefined();
    expect(nodeIdOf(knob()).ofNet(undefined)).toBeUndefined();
  });
});

describe("a probe on a pin that no net reaches", () => {
  const lone = (doc: Project) => {
    const wired = new Set(doc.nets.flatMap((n) => n.connections.map((pin) => `${pin.c}/${pin.p}`)));
    return listProbePoints(doc).find((p) => p.target.pin && !wired.has(`${p.target.pin.c}/${p.target.pin.p}`))!;
  };

  it("has no node until an instrument is on it, and then one of its own that the simulator knows", () => {
    const doc = knob();
    const point = lone(doc);
    expect(point.target.net).toBeUndefined();
    expect(nodeIdOf(doc).ofTarget(point.target)).toBeUndefined();
    doc.simulation.instruments = [{ id: "ins_1", kind: "function-generator", target: point.target }];
    const node = nodeIdOf(doc).ofTarget(point.target);
    expect(node).toBeDefined();
    expect(buildSimNetlist(doc, builtinRegistry()).net.nets.map((n) => n.id)).toContain(node);
  });

  it("is found by its pin when the net id it was added with is gone", () => {
    const doc = knob();
    const wiper = listProbePoints(doc).find((p) => p.id === "pin:cmp_pot1.W")!;
    const stale = { ...wiper.target, net: "net_renamed_away" };
    expect(nodeIdOf(doc).ofTarget(stale)).toBe(nodeIdOf(doc).ofNet("net_a0"));
  });
});

describe("netChoices", () => {
  it("lists each net once, under its own name when it has one", () => {
    const choices = netChoices(listProbePoints(knob()));
    expect(new Set(choices.map((c) => c.value)).size).toBe(choices.length);
    expect(choices.find((c) => c.value === "net_a0")).toEqual({ value: "net_a0", label: "A0" });
  });
});

describe("the ground of a document", () => {
  it("is the node the simulator measures against, and the same one the netlist reports", () => {
    const doc = knob();
    const { net } = buildSimNetlist(doc, builtinRegistry());
    expect(groundOf(doc, builtinRegistry())).toEqual({ ground: net.ground, present: true });
    expect(net.ground).not.toBe("");
  });
});
