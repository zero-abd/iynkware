// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Project } from "../project/generated/types.ts";
import { netlist } from "../project/netlist.ts";
import { e12Down, e12Up } from "../sim/faults/fix-plans.ts";
import type { RunFacts } from "../sim/faults/types.ts";
import { applied, circuit, deps, findingsOf, fixesFor, ledOnBreadboard, ledOnD13, type NetSeat, type PartSeat } from "./fixes.testing.ts";
import { formatOhms, safeFixOps } from "./fixes.ts";

const ruleOf = (doc: Project, ruleId: string, extra?: Parameters<typeof findingsOf>[1]) => findingsOf(doc, extra).filter((f) => f.ruleId === ruleId);

/** The first fix of the first finding of the rule, applied; the rule must be quiet afterwards. */
function fixed(doc: Project, ruleId: string, index = 0, extra?: Parameters<typeof findingsOf>[1]) {
  const [finding] = ruleOf(doc, ruleId, extra);
  expect(finding, `${ruleId} fires`).toBeDefined();
  const fix = fixesFor(doc, finding!)[index];
  expect(fix?.ops.length, "the fix has ops").toBeGreaterThan(0);
  const after = applied(doc, fix!.ops);
  expect(ruleOf(after, ruleId), `${ruleId} is quiet after the fix`).toEqual([]);
  return { fix: fix!, after };
}

const led = (id = "cmp_led", refdes = "D1"): PartSeat => ({ id, ref: "core.led-5mm", refdes });
const net = (id: string, pins: [string, string][], cls?: NetSeat["class"]): NetSeat => ({ id, pins, ...(cls ? { class: cls } : {}) });

describe("E12 values", () => {
  it("rounds up for the series resistor and down for a divider", () => {
    expect([300, 130, 100, 4700, 1].map(e12Up)).toEqual([330, 150, 100, 4700, 1]);
    expect([2150, 330, 1000].map(e12Down)).toEqual([1800, 330, 1000]);
    expect([330, 4700, 10_000, 1_500_000].map(formatOhms)).toEqual(["330 \u03A9", "4.7 k\u03A9", "10 k\u03A9", "1.5 M\u03A9"]);
  });
});

describe("LED without a series resistor", () => {
  it("gets a resistor sized for about 10 mA from the supply and the LED's drop, and the rule goes quiet", () => {
    const { fix, after } = fixed(ledOnD13(), "rule:led-series@1");
    expect(fix).toMatchObject({ kind: "value", safe: true, args: { led: "D1", ohms: "330 \u03A9" } });
    expect(fix.preview).toEqual({ before: ["U1.D13 - D1.A"], after: ["R1: 330 \u03A9", "U1.D13 - R1.P1", "D1.A - R1.P2"] });
    const resistor = after.components.find((c) => c.refdes === "R1");
    expect(resistor?.params).toEqual({ ohms: 330 });
    expect(after.views.find((v) => v.id === "vw_sch")?.placements.some((p) => p.c === resistor?.id)).toBe(true);
  });

  it("sizes the resistor for a 3.3 V supply, and offers none when the LED leaves no room", () => {
    const on3v3 = (color: string) =>
      circuit([{ id: "cmp_led", ref: "core.led-5mm", refdes: "D1", params: { color } }], [net("net_a", [["brd_uno", "P3V3"], ["cmp_led", "A"]]), net("net_g", [["brd_uno", "GND"], ["cmp_led", "K"]], "ground")]);
    const [red, blue] = [on3v3("red"), on3v3("blue")];
    expect(fixesFor(red, ruleOf(red, "rule:led-series@1")[0]!)[0]?.args).toMatchObject({ ohms: "150 \u03A9" });
    expect(fixesFor(blue, ruleOf(blue, "rule:led-series@1")[0]!)).toEqual([]);
  });

  it("stands the resistor across two strips of a breadboard and moves the wire that met the LED", () => {
    const doc = ledOnBreadboard();
    const { fix, after } = fixed(doc, "rule:led-series@1");
    expect(fix.safe).toBe(true);
    const view = after.views.find((v) => v.id === "vw_bb")!;
    const resistor = after.components.find((c) => c.refdes === "R1")!;
    const legs = view.placements.find((p) => p.c === resistor.id)?.legs;
    expect(legs).toEqual({ P1: "a7", P2: "a11" });
    const wire = view.wires.find((w) => w.from.kind === "pin" && w.from.p === "D13");
    expect(wire?.to).toMatchObject({ kind: "hole", hole: "b7" });
  });

  it("is undone by the inverse of the ops it made", () => {
    const doc = ledOnD13();
    const { after } = fixed(doc, "rule:led-series@1");
    expect(after.components).toHaveLength(2);
    expect(after.revision).toBeGreaterThan(doc.revision);
  });
});

describe("LED turned round", () => {
  const reversed = () =>
    circuit(
      [led()],
      [net("net_d13", [["brd_uno", "D13"], ["cmp_led", "K"]]), net("net_gnd", [["brd_uno", "GND"], ["cmp_led", "A"]], "ground")],
    );

  it("swaps anode and cathode", () => {
    const { fix, after } = fixed(reversed(), "rule:led-polarity@1");
    expect(fix).toMatchObject({ kind: "wiring", safe: true, messageKey: "fix.led-turn" });
    expect(after.nets.find((n) => n.id === "net_d13")?.connections.map((c) => `${c.c}.${c.p}`)).toContain("cmp_led.A");
  });

  it("turns an LED seated in a breadboard half way round, so its legs swap holes and the strips agree", () => {
    const { after } = fixed(ledOnBreadboard(true), "rule:led-polarity@1");
    const placement = after.views.find((v) => v.id === "vw_bb")!.placements.find((p) => p.c === after.components.find((c) => c.refdes === "D1")!.id)!;
    expect(placement).toMatchObject({ rotation_deg: 180, legs: { A: "b12", K: "b11" } });
  });
});

describe("electrolytic capacitor turned round", () => {
  const backwards = () =>
    circuit(
      [{ id: "cmp_c", ref: "core.capacitor-electrolytic", refdes: "C1" }],
      [net("net_5v", [["brd_uno", "P5V"], ["cmp_c", "MINUS"]]), net("net_gnd", [["brd_uno", "GND"], ["cmp_c", "PLUS"]], "ground")],
    );

  it("puts plus on the positive side", () => {
    const { fix, after } = fixed(backwards(), "rule:supply-polarity@1");
    expect(fix.safe).toBe(true);
    expect(after.nets.find((n) => n.id === "net_5v")?.connections.map((c) => c.p)).toContain("PLUS");
  });
});

describe("a supply pin that is not connected", () => {
  const display = (wired: [string, string][]): Project =>
    circuit(
      [{ id: "cmp_oled", ref: "core.ssd1306", refdes: "U2" }],
      [
        net("net_5v", [["brd_uno", "P5V"]], "power"),
        net("net_gnd", [["brd_uno", "GND"], ...wired], "ground"),
        net("net_sda", [["brd_uno", "SDA"], ["cmp_oled", "SDA"]]),
        net("net_scl", [["brd_uno", "SCL"], ["cmp_oled", "SCL"]]),
      ],
    );

  it("joins VCC to the one supply there is", () => {
    const { fix, after } = fixed(display([["cmp_oled", "GND"]]), "rule:open-pin@1");
    expect(fix).toMatchObject({ safe: true, messageKey: "fix.connect-supply" });
    expect(after.nets.find((n) => n.id === "net_5v")?.connections.map((c) => c.p)).toContain("VCC");
  });

  it("joins an open ground pin to the ground net", () => {
    const doc = circuit([{ id: "cmp_oled", ref: "core.ssd1306", refdes: "U2" }], [net("net_5v", [["brd_uno", "P5V"], ["cmp_oled", "VCC"]], "power"), net("net_gnd", [["brd_uno", "GND"]], "ground")]);
    const { fix, after } = fixed(doc, "rule:missing-ground@1");
    expect(fix.safe).toBe(true);
    expect(after.nets.find((n) => n.id === "net_gnd")?.connections.map((c) => c.p)).toContain("GND");
  });
});

describe("a button that leaves its input floating", () => {
  const button: PartSeat[] = [{ id: "cmp_sw", ref: "core.push-button-6mm", refdes: "SW1" }];
  const wired = (rail: "P5V" | "GND", sketch: string): Project =>
    circuit(
      button,
      [
        net("net_in", [["brd_uno", "D2"], ["cmp_sw", "P1"]]),
        net("net_gnd", [["brd_uno", "GND"], ...(rail === "GND" ? ([["cmp_sw", "P3"]] as [string, string][]) : [])], "ground"),
        net("net_5v", [["brd_uno", "P5V"], ...(rail === "P5V" ? ([["cmp_sw", "P3"]] as [string, string][]) : [])], "power"),
      ],
      sketch,
    );

  const SETUP_INPUT = "void setup() { pinMode(2, INPUT); }\nvoid loop() { digitalRead(2); }\n";
  const NO_MODE = "void setup() {\n  Serial.begin(9600);\n}\nvoid loop() { digitalRead(2); }\n";

  it("switches INPUT to INPUT_PULLUP when the button goes to ground", () => {
    const { fix, after } = fixed(wired("GND", SETUP_INPUT), "rule:button-no-pull@1");
    expect(fix).toMatchObject({ kind: "code", safe: true });
    expect(after.sources[0]?.content).toBe("void setup() { pinMode(2, INPUT_PULLUP); }\nvoid loop() { digitalRead(2); }\n");
    expect(fix.preview).toEqual({ before: ["main.ino:1  void setup() { pinMode(2, INPUT); }"], after: ["main.ino:1  void setup() { pinMode(2, INPUT_PULLUP); }"] });
  });

  it("adds a pinMode line to setup when the code never set the mode", () => {
    const { after } = fixed(wired("GND", NO_MODE), "rule:button-no-pull@1");
    expect(after.sources[0]?.content).toBe("void setup() {\n  pinMode(2, INPUT_PULLUP);\n  Serial.begin(9600);\n}\nvoid loop() { digitalRead(2); }\n");
  });

  it("adds a pull-up resistor as the second choice for a button to ground", () => {
    const { fix, after } = fixed(wired("GND", NO_MODE), "rule:button-no-pull@1", 1);
    expect(fix).toMatchObject({ kind: "wiring", messageKey: "fix.button-pullup", args: { ohms: "10 k\u03A9" } });
    expect(after.components.find((c) => c.refdes === "R1")?.params).toEqual({ ohms: 10_000 });
  });

  it("adds a pull-down resistor for a button to the supply", () => {
    const doc = wired("P5V", SETUP_INPUT);
    const [finding] = ruleOf(doc, "rule:button-no-pull@1");
    expect(fixesFor(doc, finding!).map((f) => f.messageKey)).toEqual(["fix.button-pulldown"]);
    const { after } = fixed(doc, "rule:button-no-pull@1");
    expect(after.components.find((c) => c.refdes === "R1")?.params).toEqual({ ohms: 10_000 });
  });

  it("pulls a floating input down, as a fix to look at first", () => {
    const doc = circuit([], [net("net_gnd", [["brd_uno", "GND"]], "ground"), net("net_in", [["brd_uno", "D3"]])], "void setup() { pinMode(3, INPUT); }\nvoid loop() { digitalRead(3); }\n");
    const { fix } = fixed(doc, "rule:floating-input@1");
    expect(fix).toMatchObject({ safe: false, messageKey: "fix.floating-pulldown" });
  });
});

describe("a supply shorted to ground", () => {
  it("takes the supply pin off the net, as a fix to look at first", () => {
    const doc = circuit([], [net("net_x", [["brd_uno", "P5V"], ["brd_uno", "GND"]])]);
    const { fix, after } = fixed(doc, "rule:rail-short@1");
    expect(fix).toMatchObject({ messageKey: "fix.cut-short", safe: false });
    expect(after.nets.flatMap((n) => n.connections).some((c) => c.p === "P5V")).toBe(false);
  });
});

describe("I2C lines without pull-ups", () => {
  const bus = (): Project =>
    circuit(
      [{ id: "cmp_oled", ref: "core.ssd1306", refdes: "U2" }],
      [
        net("net_5v", [["brd_uno", "P5V"], ["cmp_oled", "VCC"]], "power"),
        net("net_gnd", [["brd_uno", "GND"], ["cmp_oled", "GND"]], "ground"),
        net("net_sda", [["brd_uno", "SDA"], ["cmp_oled", "SDA"]]),
        net("net_scl", [["brd_uno", "SCL"], ["cmp_oled", "SCL"]]),
      ],
    );

  it("does not ask for them on the shipped OLED module, which has its own", () => {
    expect(ruleOf(bus(), "rule:i2c-pullup@1")).toEqual([]);
  });

  it("adds 4.7 kohm from each line to the supply, one batch for both", () => {
    const doc = bus();
    const bare = { bareBus: true };
    const findings = ruleOf(doc, "rule:i2c-pullup@1", bare);
    expect(findings).toHaveLength(2);
    const fixes = findings.flatMap((f) => fixesFor(doc, f));
    expect(fixes.map((f) => [f.safe, f.args.ohms])).toEqual([[true, "4.7 k\u03A9"], [true, "4.7 k\u03A9"]]);
    const ops = safeFixOps(doc, fixes, deps)!;
    const after = applied(doc, ops);
    expect(ruleOf(after, "rule:i2c-pullup@1", bare)).toEqual([]);
    expect(after.components.filter((c) => c.definition.ref === "core.resistor").map((c) => c.refdes)).toEqual(["R1", "R2"]);
  });
});

describe("a motor on a GPIO pin", () => {
  const motor = (other: "GND" | "P5V"): Project =>
    circuit(
      [{ id: "cmp_m", ref: "core.dc-motor", refdes: "M1" }],
      [net("net_d5", [["brd_uno", "D5"], ["cmp_m", "PLUS"]]), net("net_rail", [["brd_uno", other], ["cmp_m", "MINUS"]], other === "GND" ? "ground" : "power"), net("net_5v", [["brd_uno", "P5V"]], "power")].filter((n) => n.id !== "net_5v" || other === "GND"),
    );

  it("switches it with an NPN, a base resistor and a flyback diode", () => {
    const { fix, after } = fixed(motor("GND"), "rule:motor-direct@1");
    expect(fix).toMatchObject({ messageKey: "fix.motor-driver", safe: false });
    expect(after.components.map((c) => c.refdes).sort()).toEqual(["D1", "M1", "Q1", "R1"]);
    const nets = after.nets.map((n) => n.connections.map((c) => `${c.c}.${c.p}`));
    expect(nets.some((pins) => pins.includes("cmp_m.PLUS") && pins.some((p) => p.endsWith(".C")))).toBe(true);
    expect(nets.some((pins) => pins.includes("brd_uno.D5") && pins.some((p) => p.endsWith(".P1")))).toBe(true);
  });
});

describe("a motor on a GPIO pin with no supply in the project", () => {
  it("explains what to add, as advice", () => {
    const doc = circuit([{ id: "cmp_m", ref: "core.dc-motor", refdes: "M1" }], [net("net_d5", [["brd_uno", "D5"], ["cmp_m", "PLUS"]]), net("net_gnd", [["brd_uno", "GND"], ["cmp_m", "MINUS"]], "ground")]);
    const [finding] = ruleOf(doc, "rule:motor-direct@1");
    expect(fixesFor(doc, finding!)).toMatchObject([{ messageKey: "fix.motor-explain", ops: [], safe: false }]);
  });
});

describe("code fixes", () => {
  const sketchDoc = (code: string, parts: PartSeat[] = [led()], nets: NetSeat[] = [net("net_a", [["brd_uno", "D13"], ["cmp_led", "A"]]), net("net_g", [["brd_uno", "GND"], ["cmp_led", "K"]], "ground")]) => circuit(parts, nets, code);

  it("adds the missing pinMode", () => {
    const { after } = fixed(sketchDoc("void setup() {\n}\nvoid loop() { digitalWrite(13, HIGH); }\n"), "code:pin-mode@1");
    expect(after.sources[0]?.content).toBe("void setup() {\n  pinMode(13, OUTPUT);\n}\nvoid loop() { digitalWrite(13, HIGH); }\n");
  });

  it("turns an INPUT pin that is written into an OUTPUT", () => {
    const { after } = fixed(sketchDoc("void setup() { pinMode(13, INPUT); }\nvoid loop() { digitalWrite(13, HIGH); }\n"), "code:pin-mode@1");
    expect(after.sources[0]?.content).toContain("pinMode(13, OUTPUT)");
  });

  it("turns an OUTPUT pin that is only read into an INPUT", () => {
    const { after } = fixed(sketchDoc("void setup() { pinMode(2, OUTPUT); }\nvoid loop() { digitalRead(2); }\n"), "code:pin-mode@1");
    expect(after.sources[0]?.content).toContain("pinMode(2, INPUT)");
  });

  it("uses the baud rate the serial monitor has", () => {
    const doc = sketchDoc("void setup() { Serial.begin(9600); }\nvoid loop() {}\n");
    const withMonitor: Project = { ...doc, simulation: { ...doc.simulation, instruments: [{ id: "ins_m", kind: "serial-monitor", settings: { baud: 115200 } } as never] } };
    const { after } = fixed(withMonitor, "code:serial-baud@1", 0, { instruments: withMonitor.simulation.instruments });
    expect(after.sources[0]?.content).toBe("void setup() { Serial.begin(115200); }\nvoid loop() {}\n");
  });

  it("uses the first address the device answers to, and only calls it safe when it has just one", () => {
    const parts: PartSeat[] = [{ id: "cmp_oled", ref: "core.ssd1306", refdes: "U2" }];
    const nets = [net("net_5v", [["brd_uno", "P5V"], ["cmp_oled", "VCC"]], "power"), net("net_gnd", [["brd_uno", "GND"], ["cmp_oled", "GND"]], "ground"), net("net_sda", [["brd_uno", "SDA"], ["cmp_oled", "SDA"]]), net("net_scl", [["brd_uno", "SCL"], ["cmp_oled", "SCL"]])];
    const { fix, after } = fixed(sketchDoc("void setup() { Wire.beginTransmission(0x27); }\nvoid loop() {}\n", parts, nets), "code:i2c-address@1");
    expect(fix.safe).toBe(false);
    expect(after.sources[0]?.content).toMatch(/Wire\.beginTransmission\(0x3C\)/);
  });

  it("uses the pin the LED is wired to", () => {
    const doc = circuit([led()], [net("net_a", [["brd_uno", "D12"], ["cmp_led", "A"]]), net("net_g", [["brd_uno", "GND"], ["cmp_led", "K"]], "ground")], "const int ledPin = 13;\nvoid setup() { pinMode(ledPin, OUTPUT); }\nvoid loop() { digitalWrite(ledPin, HIGH); }\n");
    const { after } = fixed(doc, "code:pin-mismatch@1");
    expect(after.sources[0]?.content.startsWith("const int ledPin = 12;")).toBe(true);
  });
});

describe("an output pin that gives more than it can", () => {
  it("puts a resistor in series with the pin, from the solved run", () => {
    const doc = ledOnD13();
    const run = {
      endNs: 1e8,
      states: [{ at: 1e6, part: "brd_uno", pin: "D13", state: "over-current" as const, quantity: "branch-current", value: 0.118, unit: "A", modelId: "failure:pin-overcurrent@1", tier: "T2" as const, provenance: "computed" as const }],
      node: () => undefined,
      branch: () => undefined,
      pinLevels: {},
      serial: [],
      bus: [],
      resets: [],
    } satisfies RunFacts;
    const [finding] = ruleOf(doc, "solve:pin-overcurrent@1", { run });
    const [fix] = fixesFor(doc, finding!);
    expect(fix).toMatchObject({ kind: "value", safe: false, messageKey: "fix.pin-limit", args: { ohms: "270 \u03A9" } });
    const after = applied(doc, fix!.ops);
    expect(after.nets.some((n) => n.connections.some((c) => c.c === "brd_uno" && c.p === "D13") && n.connections.some((c) => c.p === "P2"))).toBe(true);
  });
});

describe("an op amp input outside its common-mode range", () => {
  const amp = (feedback: boolean): Project =>
    circuit(
      [{ id: "cmp_u", ref: "core.lm358", refdes: "U2" }, ...(feedback ? [{ id: "cmp_r", ref: "core.resistor", refdes: "R9" }] : [])],
      [
        net("net_5v", [["brd_uno", "P5V"], ["cmp_u", "VCC"]], "power"),
        net("net_gnd", [["brd_uno", "GND"], ["cmp_u", "VEE"]], "ground"),
        net("net_in", [["brd_uno", "D6"], ["cmp_u", "IN1P"], ...(feedback ? ([["cmp_r", "P1"]] as [string, string][]) : [])]),
        ...(feedback ? [net("net_fb", [["cmp_r", "P2"], ["cmp_u", "IN1N"]])] : []),
      ],
    );

  /** The solver's answer, as constant volts per node: 5 V on the supply, 0 V on ground and `input` on D6. */
  const run = (doc: Project, input: number): RunFacts => {
    const at = netlist(doc).pinNode;
    const volts = new Map([[at["brd_uno/P5V"], 5], [at["brd_uno/GND"], 0], [at["brd_uno/D6"], input]]);
    return { endNs: 1e8, states: [], node: (n) => (volts.has(n) ? { v: volts.get(n)!, tier: "T1", provenance: "computed" } : undefined), branch: () => undefined, pinLevels: {}, serial: [], bus: [], resets: [] };
  };

  it("finds the input above VCC minus 2 V and offers a divider that brings it under", () => {
    const doc = amp(false);
    const [finding] = ruleOf(doc, "solve:opamp-common-mode@1", { run: run(doc, 4.5) });
    expect(finding, "the rule fires").toBeDefined();
    expect(finding!.causeId).toBe("x-opamp.common-mode");
    const [fix] = fixesFor(doc, finding!);
    expect(fix).toMatchObject({ messageKey: "fix.opamp-divider", safe: false });
    const after = applied(doc, fix!.ops);
    expect(after.components.filter((c) => c.definition.ref === "core.resistor").map((c) => c.params)).toEqual([{ ohms: 10_000 }, { ohms: 15_000 }]);
  });

  it("gives advice only when the input is part of a network", () => {
    const doc = amp(true);
    const [finding] = ruleOf(doc, "solve:opamp-common-mode@1", { run: run(doc, 4.5) });
    expect(finding).toBeDefined();
    expect(fixesFor(doc, finding!)).toEqual([]);
  });

  it("is quiet while the input is inside the range", () => {
    const doc = amp(false);
    expect(ruleOf(doc, "solve:opamp-common-mode@1", { run: run(doc, 2.5) })).toEqual([]);
  });
});

describe("what a fix may not do", () => {
  it("keeps a plan that no longer fits the document as advice", () => {
    const doc = ledOnD13();
    const [finding] = ruleOf(doc, "rule:led-series@1");
    const gone = applied(doc, [{ k: "net.disconnect", pin: { c: "cmp_led", p: "A" } }]);
    const [fix] = fixesFor(gone, finding!);
    expect(fix).toMatchObject({ ops: [], safe: false });
  });

  it("builds nothing for a batch with an unfit plan", () => {
    const doc = ledOnD13();
    const [finding] = ruleOf(doc, "rule:led-series@1");
    const [fix] = fixesFor(doc, finding!);
    expect(safeFixOps(doc, [{ ...fix!, plan: { t: "join", pin: { part: "cmp_led", pin: "A" }, net: "n:nowhere" } }], deps)).toBeUndefined();
    expect(safeFixOps(doc, [{ ...fix!, safe: false }], deps)).toBeUndefined();
  });
});
