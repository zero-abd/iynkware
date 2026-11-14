// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { Project } from "../../project/generated/types.ts";
import { netlist } from "../../project/netlist.ts";
import type { PartStateEntry, PartStateFrame } from "../stores/run.ts";
import { blinkCircuit } from "../testing/blink-circuit.ts";
import type { BlinkCircuit } from "../testing/blink-circuit.ts";
import { derivePartStates, pinLevels } from "./part-state.ts";

let circuit: BlinkCircuit;
let d13: string;
let d2: string;

beforeAll(() => {
  circuit = blinkCircuit();
  const nl = netlist(circuit.project);
  d13 = nl.pinNode["brd_uno/D13"]!;
  d2 = nl.pinNode["brd_uno/D2"]!;
});

const frame = (pins: PartStateFrame["pins"], parts: PartStateEntry[] = []): PartStateFrame => ({ tNs: 1e9, pins, parts });

function withParts(): Project {
  const project = structuredClone(circuit.project);
  project.components.push(
    { id: "cmp_bz", definition: { ref: "core.buzzer-piezo", version: "1.0.0" }, refdes: "BZ1" },
    { id: "cmp_vr", definition: { ref: "core.potentiometer-10k", version: "1.0.0" }, refdes: "RV1", params: { pos: 0.25 } },
    { id: "cmp_x", definition: { ref: "core.mystery", version: "1.0.0" }, refdes: "X1" },
  );
  return project;
}

describe("derivePartStates", () => {
  it("lights an LED whose pin is high, through the series resistor, and darkens it when the pin is low", () => {
    expect(derivePartStates(circuit.project, frame({ [d13]: 1 })).get(circuit.led)).toEqual({ kind: "led", on: true, duty: 1 });
    expect(derivePartStates(circuit.project, frame({ [d13]: 0 })).get(circuit.led)).toEqual({ kind: "led", on: false, duty: 0 });
    expect(derivePartStates(circuit.project, frame({})).get(circuit.led)).toEqual({ kind: "led", on: false, duty: 0 });
  });

  it("takes PWM duty from the simulator's entry for the part", () => {
    const entry: PartStateEntry = { part: circuit.led, kind: "led", lit: true, brightness: 0.4 };
    expect(derivePartStates(circuit.project, frame({ [d13]: 1 }, [entry])).get(circuit.led)).toEqual({ kind: "led", on: true, duty: 0.4 });
    const dark: PartStateEntry = { part: circuit.led, kind: "led", lit: false, brightness: 0 };
    expect(derivePartStates(circuit.project, frame({ [d13]: 1 }, [dark])).get(circuit.led)).toEqual({ kind: "led", on: false, duty: 0 });
  });

  it("reports a button as pressed from its entry and released without one", () => {
    const pressed: PartStateEntry = { part: circuit.button, kind: "button", pressed: true };
    expect(derivePartStates(circuit.project, frame({}, [pressed])).get(circuit.button)).toEqual({ kind: "button", pressed: true });
    expect(derivePartStates(circuit.project, frame({})).get(circuit.button)).toEqual({ kind: "button", pressed: false });
  });

  it("marks a buzzer the simulator does not model as none, and reads its tone when it does", () => {
    const states = derivePartStates(withParts(), frame({}, [{ part: "cmp_bz", kind: "not-modelled", reason: "digital slice" }]));
    expect(states.get("cmp_bz")).toEqual({ kind: "none", reason: "not-modelled-yet" });
    const sounding = derivePartStates(withParts(), frame({}, [{ part: "cmp_bz", kind: "buzzer", on: true, hz: 440 }]));
    expect(sounding.get("cmp_bz")).toEqual({ kind: "buzzer", tone: 440 });
    expect(derivePartStates(withParts(), frame({}, [{ part: "cmp_bz", kind: "buzzer", on: false, hz: 440 }])).get("cmp_bz")).toEqual({
      kind: "buzzer",
      tone: null,
    });
  });

  it("gives a part with an unknown definition the not modelled mark", () => {
    expect(derivePartStates(withParts(), frame({})).get("cmp_x")).toEqual({ kind: "none", reason: "not-modelled-yet" });
  });

  it("reads the potentiometer position from its entry, and leaves a pot with none to the knob ring", () => {
    expect(derivePartStates(withParts(), frame({})).has("cmp_vr")).toBe(false);
    expect(derivePartStates(withParts(), frame({}, [{ part: "cmp_vr", kind: "pot", position: 0.8 }])).get("cmp_vr")).toEqual({
      kind: "pot",
      position: 0.8,
    });
  });

  it("leaves out boards, the breadboard and resistors, and drops entries for parts that are gone", () => {
    const states = derivePartStates(circuit.project, frame({}, [{ part: "cmp_gone", kind: "button", pressed: true }]));
    expect([...states.keys()].sort()).toEqual([circuit.button, circuit.led].sort());
  });
});

describe("parts only the analog solver models", () => {
  it("get no visual state, so they are not marked as not modelled yet, while a part with no model still is", () => {
    const project = structuredClone(circuit.project);
    project.components.push(
      { id: "cmp_c", definition: { ref: "core.capacitor-electrolytic", version: "1.0.0" }, refdes: "C1" },
      { id: "cmp_u", definition: { ref: "core.lm358", version: "1.0.0" }, refdes: "U2" },
      { id: "cmp_d", definition: { ref: "core.diode-1n4007", version: "1.0.0" }, refdes: "D1" },
      { id: "cmp_x", definition: { ref: "core.mystery", version: "1.0.0" }, refdes: "X1" },
    );
    const states = derivePartStates(project, frame({}));
    expect(states.has("cmp_c")).toBe(false);
    expect(states.has("cmp_u")).toBe(false);
    expect(states.has("cmp_d")).toBe(false);
    expect(states.get("cmp_x")).toEqual({ kind: "none", reason: "not-modelled-yet" });
  });
});

describe("pinLevels", () => {
  it("maps every pin on a net to its node's level, with null for what the frame does not drive", () => {
    const levels = pinLevels(circuit.project, frame({ [d13]: 1, [d2]: "Z" }));
    expect(levels.get("brd_uno/D13")).toBe(1);
    expect(levels.get(`${circuit.r1}/P1`)).toBe(1);
    expect(levels.get("brd_uno/D2")).toBeNull();
    expect(levels.get("brd_uno/GND")).toBeNull();
  });

  it("shows a part by what a provider reported, even when its descriptor says it is not modelled", () => {
    const project = structuredClone(circuit.project);
    project.components.push(
      { id: "cmp_sv", definition: { ref: "core.servo-sg90", version: "1.0.0" }, refdes: "M1" },
      { id: "cmp_dc", definition: { ref: "core.dc-motor", version: "1.0.0" }, refdes: "M2" },
      { id: "cmp_st", definition: { ref: "core.stepper-28byj48", version: "1.0.0" }, refdes: "M3" },
      { id: "cmp_us", definition: { ref: "core.hc-sr04", version: "1.0.0" }, refdes: "U2" },
    );
    const bare = derivePartStates(project, frame({}));
    expect(bare.get("cmp_us")).toEqual({ kind: "none", reason: "not-modelled-yet" });
    const states = derivePartStates(
      project,
      frame({}, [
        { part: "cmp_sv", kind: "servo", angle: 400, powered: true },
        { part: "cmp_dc", kind: "motor", rpm: -1200, stalled: false, powered: true },
        { part: "cmp_st", kind: "stepper", angle: 90, steps: 512, powered: true },
        { part: "cmp_us", kind: "reading", value: 23.4, unit: "cm", label: "dist" },
      ]),
    );
    expect(states.get("cmp_sv")).toEqual({ kind: "servo", angle: 180, powered: true });
    expect(states.get("cmp_dc")).toEqual({ kind: "motor", rpm: -1200, stalled: false, powered: true });
    expect(states.get("cmp_st")).toEqual({ kind: "stepper", angle: 90, steps: 512, powered: true });
    expect(states.get("cmp_us")).toEqual({ kind: "reading", value: 23.4, unit: "cm", label: "dist" });
  });

  it("ignores a provider entry with missing numbers, and a modelled part then shows nothing rather than a wrong state", () => {
    const project = structuredClone(circuit.project);
    project.components.push({ id: "cmp_sv", definition: { ref: "core.servo-sg90", version: "1.0.0" }, refdes: "M1" });
    const states = derivePartStates(project, frame({}, [{ part: "cmp_sv", kind: "servo", angle: Number.NaN, powered: true }]));
    expect(states.get("cmp_sv")).toBeUndefined();
  });

  it("gives a modelled part with no state of its own, such as a driver board or a mechanical part, no tag", () => {
    const project = structuredClone(circuit.project);
    project.components.push(
      { id: "cmp_drv", definition: { ref: "core.uln2003-module", version: "1.0.0" }, refdes: "U9" },
      { id: "cmp_whl", definition: { ref: "core.wheel-65", version: "1.0.0" }, refdes: "W1" },
    );
    const states = derivePartStates(project, frame({}, []));
    expect(states.has("cmp_drv")).toBe(false);
    expect(states.has("cmp_whl")).toBe(false);
  });

  it("gives a pot no not-modelled mark when the pin layer has no rule for it, and leaves its turn to the knob ring", () => {
    const project = structuredClone(circuit.project);
    project.components.push({ id: "cmp_pot", definition: { ref: "core.potentiometer-10k", version: "1.0.0" }, refdes: "RV1" });
    const states = derivePartStates(project, frame({}, [{ part: "cmp_pot", kind: "not-modelled", reason: "x" }]));
    expect(states.has("cmp_pot")).toBe(false);
  });

  it("lights a traffic light from its lamp currents and names the lit lamps", () => {
    const project = structuredClone(circuit.project);
    project.components.push({ id: "cmp_tl", definition: { ref: "core.traffic-light", version: "1.0.0" }, refdes: "L9" });
    const entry = { part: "cmp_tl", kind: "led", lit: true, brightness: 1, provenance: "approximation", tier: "T0", lamps: ["G"] };
    expect(derivePartStates(project, frame({}, [entry])).get("cmp_tl")).toEqual({ kind: "led", on: true, duty: 1, lamps: ["G"] });
  });

  it("takes a display entry with its rows and text runs", () => {
    const project = structuredClone(circuit.project);
    project.components.push({ id: "cmp_oled", definition: { ref: "core.ssd1306", version: "1.0.0" }, refdes: "D1" });
    const entry = { part: "cmp_oled", kind: "display", w: 8, h: 2, on: true, inverted: false, rows: ["f0", "0f"], texts: [{ x: 0, y: 0, size: 1, text: "Hi" }, { x: "bad" }] };
    expect(derivePartStates(project, frame({}, [entry])).get("cmp_oled")).toEqual({ kind: "display", w: 8, h: 2, on: true, inverted: false, rows: ["f0", "0f"], texts: [{ x: 0, y: 0, size: 1, text: "Hi" }] });
  });
});
