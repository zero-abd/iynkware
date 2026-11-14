// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "@/parts/builtin";
import type { Project } from "@/project/generated/types";
import { UNO_PIN_MAP } from "@/sim/mcu/avr8js-pins";
import { buildSimNetlist } from "@/sim/netlist";
import { rangersOf } from "./mech";

describe("the distance starter", () => {
  const doc = JSON.parse(readFileSync("src/studio/starters/distance.project.json", "utf8")) as Project;
  const { net } = buildSimNetlist(doc, builtinRegistry());

  it("wires its HC-SR04 to the pins the sketch uses, which both engines can answer on", () => {
    const sketch = doc.sources.find((s) => s.role === "firmware")!.content;
    const pin = (name: string) => `D${new RegExp(`const int ${name} = (\\d+);`).exec(sketch)![1]}`;
    expect(rangersOf(net)).toEqual([{ part: expect.any(String), trig: pin("TRIG"), echo: pin("ECHO") }]);
    for (const name of ["TRIG", "ECHO"]) expect(UNO_PIN_MAP[pin(name)]).toBeDefined();
  });
});
