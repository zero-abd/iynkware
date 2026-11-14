// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { utf8Encode } from "../../core/canonical.ts";
import { runHeadless, sampleAt } from "@/lib/interp";
import { builtinRegistry } from "../../parts/builtin.ts";
import { readIynk, writeIynk } from "../iynk.ts";
import { buildSimNetlist } from "../../sim/netlist.ts";
import { netlist } from "../../project/netlist.ts";
import { writeZip } from "../zip.ts";
import { importWokwi, libraryNames, wireColour, WOKWI_LOSS } from "./import.ts";
import type { WokwiFile } from "./import.ts";
import { ohmsOf } from "./parts.ts";

const registry = builtinRegistry();
const FIXTURES = join(import.meta.dirname, "fixtures");
const env = { id: "prj_00000000000000000000000000", now: "2026-11-10T10:00:00.000Z", locale: "en", actor: "usr_tester", registry };

const fixture = (name: string): WokwiFile[] =>
  readdirSync(join(FIXTURES, name)).map((file) => ({ name: file, bytes: new Uint8Array(readFileSync(join(FIXTURES, name, file))) }));

function load(name: string, title = name) {
  const result = importWokwi(fixture(name), { ...env, title });
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** The pins in each net as `REFDES.PIN`, from the project the import made. */
function nets(name: string): string[][] {
  const { project } = load(name);
  const refdes = new Map([...project.boards, ...project.components].map((c) => [c.id, c.refdes]));
  return project.nets.map((n) => n.connections.map((c) => `${refdes.get(c.c)}.${c.p}`).sort()).sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
}

describe("the Wokwi blink", () => {
  const { project, loss } = load("blink");

  it("is an Uno, an LED and a 220 ohm resistor wired as the diagram says", () => {
    expect(project.boards[0]!.definition.ref).toBe("core.uno-r3");
    expect(project.components.map((c) => [c.refdes, c.definition.ref, c.params?.color ?? c.params?.ohms])).toEqual([
      ["LED1", "core.led-5mm", "green"],
      ["R1", "core.resistor", 220],
    ]);
    expect(nets("blink")).toEqual([
      ["LED1.A", "R1.P2"],
      ["LED1.K", "U1.GND"],
      ["R1.P1", "U1.D13"],
    ]);
  });

  it("keeps the wire colours and the position of every part", () => {
    const view = project.views.find((v) => v.id === "vw_bb")!;
    expect(view.wires.map((w) => w.color)).toEqual(["green", "green", "black"]);
    expect(view.placements.map((p) => p.c).sort()).toEqual(["brd_main", ...project.components.map((c) => c.id)].sort());
  });

  it("names and classes the nets by the board pins on them", () => {
    expect(project.nets.map((n) => [n.name, n.class])).toEqual([["D13", "signal"], ["GND", "ground"], [undefined, "signal"]]);
  });

  it("carries the sketch, and says the serial monitor wire was left out", () => {
    expect(project.sources[0]!.path).toBe("main.ino");
    expect(project.sources[0]!.content).toContain("digitalWrite(13, HIGH)");
    expect(loss.map((l) => l.code)).toContain(WOKWI_LOSS.serial);
    expect(loss.some((l) => l.code === WOKWI_LOSS.notImported)).toBe(false);
  });

  it("makes a project the file format accepts and the simulator builds a netlist from", () => {
    const back = readIynk(writeIynk(project), () => Date.parse(env.now));
    expect(back.ok).toBe(true);
    const sim = buildSimNetlist(project, registry);
    expect(sim.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(sim.net.ground).not.toBe("");
    expect(netlist(project).diagnostics.filter((d) => d.code === "NL-SINGLE-PIN")).toEqual([]);
  });

  it("is the same bytes for the same files", () => {
    expect(writeIynk(load("blink").project)).toEqual(writeIynk(project));
  });
});

describe("running the imported sketch", () => {
  it("blinks pin 13 every 500 ms, as the Wokwi sketch does", () => {
    const { project } = load("blink");
    const trace = runHeadless({ board: "uno-r3", language: "arduino-cpp", source: project.sources[0]!.content, world: { inputs: [], script: [] }, runMs: 2500 });
    expect(trace.error).toBeNull();
    expect([250, 750, 1250, 1750].map((t) => sampleAt(trace.pins.D13!, t)?.v)).toEqual([1, 0, 1, 0]);
  });
});

describe("other boards", () => {
  it("imports an ESP32 DevKit v1 with D2 on GPIO2", () => {
    expect(load("esp32-blink").project.boards[0]!.definition.ref).toBe("core.esp32-devkitc");
    expect(nets("esp32-blink")).toContainEqual(["R1.P1", "U1.GPIO2"]);
  });

  it("imports a Pico with its MicroPython main.py", () => {
    const { project } = load("pico-blink");
    expect(project.boards[0]!.firmware).toMatchObject({ language: "micropython" });
    expect(project.sources[0]).toMatchObject({ path: "main.py", language: "micropython" });
    expect(nets("pico-blink")).toContainEqual(["R1.P1", "U1.GP15"]);
  });

  it("imports a Nano with its analog pins", () => {
    const { project } = load("parking");
    expect(project.boards[0]!.definition.ref).toBe("core.nano");
    expect(nets("parking")).toContainEqual(["OLED1.SDA", "U1.A4"]);
  });
});

describe("parts and attributes", () => {
  it("maps a servo, a knob and the libraries", () => {
    const { project } = load("servo-knob");
    expect(project.components.map((c) => c.definition.ref).sort()).toEqual(["core.potentiometer-10k", "core.servo-sg90"]);
    expect(project.components.find((c) => c.refdes === "POT1")!.params!.pos).toBeCloseTo(512 / 1023, 6);
    expect(project.boards[0]!.firmware!.libraries).toEqual(["Servo"]);
    expect(nets("servo-knob")).toContainEqual(["POT1.W", "U1.A0"]);
    expect(nets("servo-knob")).toContainEqual(["POT1.P3", "SERVO1.VPLUS", "U1.P5V"]);
  });

  it("says that the servo is only drawn, so the review does not claim nothing is lost", () => {
    const { loss } = load("servo-knob");
    expect(loss.filter((l) => l.code === WOKWI_LOSS.approximated).map((l) => l.args)).toContainEqual({ id: "servo1", type: "wokwi-servo", reason: "drawn-only", detail: "" });
  });

  it("maps a button, a slide switch, a 1k resistor and an orange LED to the nearest LED colour", () => {
    const { project, loss } = load("button-led");
    const part = (refdes: string) => project.components.find((c) => c.refdes === refdes)!;
    expect(part("R1").params!.ohms).toBe(1000);
    expect(part("LED1").params!.color).toBe("yellow");
    expect(part("SW1").params!.closed).toBe(1);
    expect(nets("button-led")).toContainEqual(["BTN1.P1", "U1.D2"]);
    expect(nets("button-led")).toContainEqual(["BTN1.P3", "LED1.K", "U1.GND"]);
    expect(loss.find((l) => l.args?.reason === "colour-nearest")).toBeDefined();
    expect(project.views[0]!.wires.map((w) => w.color)).toContain("orange");
  });

  it("expands a photoresistor module into an LDR and its 10k divider resistor and reports the digital output", () => {
    const { project, loss } = load("light-sensor");
    expect(project.components.map((c) => c.definition.ref).sort()).toEqual(["core.ldr", "core.resistor", "core.rgb-led"]);
    expect(project.components.find((c) => c.definition.ref === "core.ldr")!.params!.lux).toBe(800);
    expect(project.components.find((c) => c.definition.ref === "core.rgb-led")!.params!.common).toBe("cathode");
    expect(nets("light-sensor")).toContainEqual(["LDR1.P2", "LDR1_1.P1", "U1.A0"]);
    expect(loss.find((l) => l.code === WOKWI_LOSS.pin && l.args?.pin === "ldr1:DO")).toBeDefined();
  });

  it("flattens a breadboard into the nets its strips make", () => {
    expect(nets("breadboard-led")).toEqual([
      ["LED1.A", "R1.P2"],
      ["LED1.K", "U1.GND"],
      ["R1.P1", "U1.D13"],
    ]);
    const { project } = load("breadboard-led");
    expect(project.views[0]!.wires).toEqual([]);
    expect(project.components.map((c) => c.definition.ref)).not.toContain("core.breadboard-half");
  });
});

describe("what does not come across", () => {
  const { project, loss } = load("display-dht");

  it("lists each part with no iynk match and why, and never drops one silently", () => {
    const listed = loss.filter((l) => l.code === WOKWI_LOSS.notImported).map((l) => [l.args!.id, l.args!.type, l.args!.reason, l.args!.count]);
    expect(listed).toEqual([
      ["lcd1", "wokwi-lcd1602", "no-display", 1],
      ["dht1", "wokwi-dht22", "no-sensor", 3],
      ["rgb1", "wokwi-neopixel", "no-led-chain", 1],
      ["mega", "wokwi-arduino-mega", "no-board", 1],
    ]);
    expect(project.components.map((c) => c.refdes)).toEqual(["LED1"]);
  });

  it("says which pin of an imported part has no counterpart", () => {
    expect(loss.find((l) => l.code === WOKWI_LOSS.pin)).toMatchObject({ args: { pin: "led1:X", reason: "pin-unknown" } });
  });

  it("keeps the wires between the parts that did come across", () => {
    expect(nets("display-dht")).toEqual([["LED1.A", "U1.D5"], ["LED1.K", "U1.GND"]]);
  });
});

describe("the input", () => {
  const files = fixture("blink");

  it("reads the same project from a zip", () => {
    const zip = writeZip(files.map((f) => ({ path: `blink/${f.name}`, data: f.bytes })));
    const result = importWokwi([{ name: "blink.zip", bytes: zip }], { ...env, title: "blink" });
    expect(result.ok && writeIynk(result.value.project)).toEqual(writeIynk(load("blink").project));
  });

  it("refuses files with no diagram.json", () => {
    expect(importWokwi(files.filter((f) => f.name !== "diagram.json"), env)).toMatchObject({ ok: false, error: { code: "no-diagram" } });
  });

  it("refuses text that is not a diagram", () => {
    const bad = (text: string) => importWokwi([{ name: "diagram.json", bytes: utf8Encode(text) }], env);
    expect(bad("{")).toMatchObject({ ok: false, error: { code: "bad-json" } });
    expect(bad('{"parts": 3}')).toMatchObject({ ok: false, error: { code: "not-a-diagram" } });
    expect(bad('{"parts": [{"id": "a", "type": "wokwi-led"}, {"id": "a", "type": "wokwi-led"}]}')).toMatchObject({ ok: false, error: { code: "not-a-diagram" } });
  });

  it("adds an Uno when the diagram has no board, and says so", () => {
    const result = importWokwi([{ name: "diagram.json", bytes: utf8Encode('{"parts": [{"id": "r1", "type": "wokwi-resistor", "attrs": {}}], "connections": []}') }], env);
    expect(result.ok && result.value.loss.map((l) => l.code)).toContain(WOKWI_LOSS.noBoard);
  });

  it("counts connections it cannot read", () => {
    const text = '{"parts": [{"id": "uno", "type": "wokwi-arduino-uno"}], "connections": [["uno:13"], 5]}';
    const result = importWokwi([{ name: "diagram.json", bytes: utf8Encode(text) }], env);
    expect(result.ok && result.value.loss.find((l) => l.code === WOKWI_LOSS.malformed)?.args).toEqual({ count: 2 });
  });
});

describe("small readers", () => {
  it("reads resistor values the way Wokwi writes them", () => {
    expect([ohmsOf("220"), ohmsOf("1k"), ohmsOf("4k7"), ohmsOf("10M"), ohmsOf("1.5k"), ohmsOf("2R2"), ohmsOf("lots"), ohmsOf("0")]).toEqual([220, 1000, 4700, 1e7, 1500, 2.2, undefined, undefined]);
  });

  it("matches a wire colour to one of the ten, by name or by hex", () => {
    expect([wireColour("gray"), wireColour("limegreen"), wireColour("#ff0000"), wireColour("#00a"), wireColour(""), wireColour("plaid")]).toEqual(["grey", "green", "red", "blue", undefined, undefined]);
  });

  it("reads libraries.txt without versions, comments or links", () => {
    expect(libraryNames("# c\nServo@1.2.1\n\nDHT sensor library\nServo\nhttps://github.com/x/y\n")).toEqual({ names: ["Servo", "DHT sensor library"], skipped: 1 });
  });
});

describe("the layout", () => {
  it.each(["button-led", "servo-knob", "breadboard-led", "light-sensor"])("puts no part of %s on top of another or on the board", (name) => {
    const { project } = load(name);
    const view = project.views.find((v) => v.id === "vw_bb")!;
    const boxes = view.placements.map((p) => {
      const d = registry.latest([...project.boards, ...project.components].find((c) => c.id === p.c)!.definition.ref)!;
      const body = d.dimensions?.body ?? d.dimensions?.board ?? { w: 0, h: 0 };
      const turned = (p.rotation_deg ?? 0) % 180 !== 0;
      return { id: p.c, x: p.x_mm, y: p.y_mm, w: turned ? body.h : body.w, h: turned ? body.w : body.h };
    });
    const apart = (a: (typeof boxes)[number], b: (typeof boxes)[number]) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    const flat = new Set(project.components.filter((c) => c.definition.ref === "core.breadboard-half").map((c) => c.id));
    const solid = boxes.filter((b) => !flat.has(b.id));
    for (const a of solid) for (const b of solid) if (a.id < b.id) expect(apart(a, b), `${a.id} and ${b.id}`).toBe(true);
  });
});
