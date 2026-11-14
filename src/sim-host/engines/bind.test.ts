// @vitest-environment node
import { describe, expect, it } from "vitest";
import { builtinRegistry } from "@/parts/builtin";
import { loadExample } from "@/project/apply/fixtures.testing";
import type { WorldInput } from "@/project/generated/types";
import { getProfile } from "@/sim/boards/profiles";
import { createDigitalNets } from "@/sim/digital/nets";
import type { PartKind, ProgramImage, SimNetlist, SimPart, SimRunOptions, SliceBudget } from "@/sim/engine";
import { buildSimNetlist } from "@/sim/netlist";
import { createOrchestrator } from "@/sim/orchestrator";
import { bindWorld, wiredI2cDevices } from "./bind";
import { createInterpEngine } from "./interp-engine";

const MS = 1_000_000;
const BUDGET: SliceBudget = { shouldYield: () => false, work: { statements: Infinity, events: Infinity, outputBytes: Infinity } };
const OPTS: SimRunOptions = { seed: 1, speed: 1, limits: { statements: 4_000_000, events: 100_000, outputBytes: 65_536 }, tier: "T1" };

const image = (text: string): ProgramImage => ({ kind: "source", language: "arduino-cpp", files: [{ path: "main", text }], entry: "main" });

const part = (id: string, kind: PartKind, pins: SimPart["pins"]): SimPart => ({ id, descriptor: `test.${kind}@1.0.0`, params: {}, pins, kind });

function withButtonOn(pin: "D2" | "D3"): SimNetlist {
  const parts = [part("brd", "board", { D2: "n2", D3: "n3", GND: "gnd" }), part("sw", "button", { P1: pin === "D2" ? "n2" : "n3", P2: pin === "D2" ? "n2" : "n3", P3: "gnd", P4: "gnd" })];
  return {
    version: 1,
    docHash: "0",
    nets: ["n2", "n3", "gnd"].map((id) => ({ id })),
    ground: "gnd",
    parts,
    settings: { seed: 1, toleranceMode: "nominal", analog: { mode: "dc-event", stepNs: 1000 }, speed: 1 },
  };
}

const BUTTON: WorldInput = {
  id: "in_button",
  quantity: "button",
  device: { kind: "button", pull: "internal-up", bounceMs: 0 },
  component: "sw",
  min: 0,
  max: 1,
  step: 1,
  default: 0,
  gesture: "press",
  label: { en: "Button" },
};

const READ_PINS = `void setup() {
  pinMode(2, INPUT_PULLUP);
  pinMode(3, INPUT_PULLUP);
}
void loop() {}
`;

describe("bindWorld", () => {
  function bound(pin: "D2" | "D3") {
    const engine = createInterpEngine({ id: "mcu", board: "uno-r3", language: "arduino", seed: 1 });
    expect(engine.load(image(READ_PINS)).ok).toBe(true);
    const { binding, inputs } = bindWorld(engine, withButtonOn(pin), [BUTTON], getProfile("uno-r3"));
    expect(inputs[0].pins).toEqual([pin]);
    return { engine, press: () => binding.apply(inputs[0], 1) };
  }

  it("presses the pin the button's wire reaches", () => {
    const { engine, press } = bound("D2");
    engine.advanceTo(2 * MS, BUDGET);
    expect(engine.pins.read(2).level).toBe(1);
    press();
    expect(engine.pins.read(2).level).toBe(0);
    expect(engine.pins.read(3).level).toBe(1);
  });

  it("presses another pin when the wire is moved", () => {
    const { engine, press } = bound("D3");
    engine.advanceTo(2 * MS, BUDGET);
    press();
    expect(engine.pins.read(3).level).toBe(0);
    expect(engine.pins.read(2).level).toBe(1);
  });
});

const BLINK_D13 = `void setup() { pinMode(13, OUTPUT); }
void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`;

describe("Blink through the document", () => {
  function runBlink(wire: "D12" | "D13") {
    const doc = loadExample("uno-blink-d12");
    doc.nets.find((n) => n.id === "net_d12")!.connections.find((c) => c.c === "brd_uno")!.p = wire;
    const { net, diagnostics } = buildSimNetlist(doc, builtinRegistry());
    expect(diagnostics).toEqual([]);
    const engine = createInterpEngine({ id: "mcu", board: "uno-r3", language: "arduino", seed: 1 });
    expect(engine.load(image(BLINK_D13)).ok).toBe(true);
    const digital = createDigitalNets();
    const orch = createOrchestrator({ engines: [engine], digital });
    expect(orch.load(net, OPTS).ok).toBe(true);
    const litAt = (ms: number): boolean => {
      orch.runUntil(ms * MS, BUDGET);
      const led = digital.partStates().find((s) => s.part === "cmp_led1");
      return led?.kind === "led" && led.lit;
    };
    return [litAt(250), litAt(750), litAt(1250)];
  }

  it("lights the LED in the high half when the wire is on the pin the sketch writes", () => {
    expect(runBlink("D13")).toEqual([true, false, true]);
  });

  it("leaves the LED dark when the wire is on another pin", () => {
    expect(runBlink("D12")).toEqual([false, false, false]);
  });
});

describe("wiredI2cDevices", () => {
  const registry = builtinRegistry();
  const describeOf = (p: SimPart) => {
    const at = p.descriptor.lastIndexOf("@");
    return registry.get(p.descriptor.slice(0, at), p.descriptor.slice(at + 1));
  };
  const real = (id: string, descriptor: string, pins: SimPart["pins"], kind: PartKind = "other"): SimPart => ({ id, descriptor, params: {}, pins, kind });
  function circuit(sda: string, scl: string): SimNetlist {
    const parts = [
      real("brd", "core.uno-r4@1.0.0", { [sda]: "sda", [scl]: "scl", P5V: "v5", P3V3: "v33", GND: "gnd" }, "board"),
      real("imu", "core.gy521-mpu6050@1.0.0", { VCC: "v5", GND: "gnd", SDA: "sda", SCL: "scl" }),
      real("env", "core.bme280-module@1.1.0", { VCC: "v33", GND: "gnd", SDA: "sda", SCL: "scl" }),
    ];
    return { version: 1, docHash: "0", nets: ["sda", "scl", "v5", "v33", "gnd"].map((id) => ({ id })), ground: "gnd", parts, settings: withButtonOn("D2").settings };
  }
  const SKETCH = `#include <Wire.h>
void setup() {
  Serial.begin(9600);
  Wire.begin();
  Wire.beginTransmission(0x68); Serial.print(Wire.endTransmission());
  Wire.beginTransmission(0x76); Serial.print(Wire.endTransmission());
  Wire.beginTransmission(0x75); Serial.println(Wire.endTransmission());
  Wire.beginTransmission(0x68); Wire.write(0x75); Wire.endTransmission();
  Wire.requestFrom(0x68, 1); Serial.println(Wire.read());
}
void loop() { delay(10); }`;

  it.each([["A4", "A5"], ["SDA", "SCL"]])("answers plain Wire calls from the MPU-6050 and BME280 wired on %s and %s", (sda, scl) => {
    const net = circuit(sda, scl);
    const engine = createInterpEngine({ id: "brd", board: "uno-r4", language: "arduino", seed: 1, i2cDevices: (nowNs) => wiredI2cDevices(net, "brd", getProfile("uno-r4"), describeOf, nowNs) });
    expect(engine.load(image(SKETCH)).ok).toBe(true);
    const orch = createOrchestrator({ engines: [engine], digital: createDigitalNets() });
    expect(orch.load(net, OPTS).ok).toBe(true);
    orch.runUntil(50 * MS, BUDGET);
    expect(engine.serialLog.map((l) => l.text).join("")).toBe("002\r\n104\r\n");
  });

  it("reads the BME280 through its library", () => {
    const net = circuit("A4", "A5");
    const sketch = `#include <Wire.h>
#include <Adafruit_BME280.h>
Adafruit_BME280 bme;
void setup() { Serial.begin(9600); Serial.println(bme.begin(0x76) ? "ok" : "none"); Serial.println(bme.readTemperature()); }
void loop() { delay(10); }`;
    const engine = createInterpEngine({ id: "brd", board: "uno-r4", language: "arduino", seed: 1, i2cDevices: (nowNs) => wiredI2cDevices(net, "brd", getProfile("uno-r4"), describeOf, nowNs) });
    expect(engine.load(image(sketch)).ok).toBe(true);
    const orch = createOrchestrator({ engines: [engine], digital: createDigitalNets() });
    expect(orch.load(net, OPTS).ok).toBe(true);
    orch.runUntil(400 * MS, BUDGET);
    const [ok, temp] = engine.serialLog.map((l) => l.text).join("").trim().split(/\s+/);
    expect(ok).toBe("ok");
    expect(Number(temp)).toBeGreaterThan(15);
    expect(Number(temp)).toBeLessThan(35);
  });
});
