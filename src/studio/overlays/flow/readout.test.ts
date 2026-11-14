// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Project } from "../../../project/generated/types.ts";
import { emptyAnalog } from "../../run/analog.ts";
import { breadboardPlan } from "./plan.ts";
import { readingFor } from "./readout.ts";

const rc = JSON.parse(readFileSync(join(__dirname, "../../starters/rc-led.project.json"), "utf8")) as Project;
const plan = breadboardPlan(rc, rc.views.find((v) => v.kind === "breadboard")!.id)!;
const snapshot = {
  ...emptyAnalog(),
  volts: { "n:brd_uno/ICSP1_2": 5, "n:brd_uno/GND": 0 },
  pinAmps: { brd_uno: { P5V: -0.006, GND: 0.006 }, cmp_r1: { P1: 0.006, P2: -0.006 } },
  parts: { cmp_r1: { watts: 0.0000169, state: "ok" as const } },
};

describe("the hover readout", () => {
  it("reads nothing when the pointer is over nothing or over something the frame has no numbers for", () => {
    expect(readingFor(rc, snapshot, plan, null)).toBeNull();
    expect(readingFor(rc, emptyAnalog(), plan, { kind: "part", c: "cmp_r1" })).toBeNull();
    expect(readingFor(rc, snapshot, plan, { kind: "handle", of: "x", handle: "leg", index: 0 })).toBeNull();
  });

  it("gives a wire its net's volts and the current the plan finds in it", () => {
    const reading = readingFor(rc, snapshot, plan, { kind: "wire", id: "wir_2", segment: 0 });
    expect(reading).toMatchObject({ kind: "wire", volts: 5 });
    expect((reading as { amps: number }).amps).toBeCloseTo(0.006, 9);
  });

  it("gives a two pin part the volts across it, the current into its first pin, its power and its health", () => {
    const reading = readingFor(rc, snapshot, plan, { kind: "part", c: "cmp_r1" });
    expect(reading).toMatchObject({ kind: "part", part: "R1", amps: 0.006, watts: 0.0000169, state: "ok" });
  });

  it("adds the pin the pointer is on, with the current into it", () => {
    const reading = readingFor(rc, snapshot, plan, { kind: "pin", c: "cmp_r1", p: "P2" });
    expect(reading).toMatchObject({ pin: { name: "P2", amps: -0.006 } });
  });
});
